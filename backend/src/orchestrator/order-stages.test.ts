// Order stages (P4) over FakeDb: the transition matrix, the history trail, and what the buyer hears at dispatch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus } from '@app/shared';
import { FakeDb } from '../test-support/fake-db';
import { markDelivered, markDispatched, markPreparing, STAGE_FROM, type Stage } from './order-stages';

const sent = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[] }));
vi.mock('../whatsapp/client', () => ({
  sendText: async (_p: string, to: string, body: string) => { sent.texts.push({ to, body }); return { waMessageId: `wamid.${sent.texts.length}` }; },
  sendDocument: async () => ({ waMessageId: null }),
  sendTemplate: async () => ({ waMessageId: null }),
}));

const M = 'merchant-1';
const a = { merchantId: M, memberId: 'member-1' };
let db: FakeDb;
let orderId: string;

function seed(status: string, windowOpen = true) {
  db = new FakeDb();
  sent.texts = [];
  db.add('merchants', { id: M, business_name: 'Shop', settings: {} });
  db.add('customers', { id: 'cust-1', merchant_id: M, wa_id: '923001112222' });
  db.add('whatsapp_numbers', { id: 'num-1', merchant_id: M, phone_number_id: 'pn-1' });
  db.add('conversations', { id: 'conv-1', merchant_id: M, customer_id: 'cust-1', whatsapp_number_id: 'num-1', window_expires_at: new Date(Date.now() + (windowOpen ? 1 : -1) * 3_600_000).toISOString(), context: {} });
  const o = db.add('orders', { merchant_id: M, customer_id: 'cust-1', conversation_id: 'conv-1', order_number: 'SK-1001', status, payment_method: 'cod', payment_status: 'cod_pending', slip_url: null, delivery_name: 'Ali', pending_buyer_notice: null });
  orderId = o.id;
  db.add('order_status_history', { order_id: orderId, from_status: 'draft', to_status: 'confirmed', changed_by: 'bot' });
}
const order = () => db.rows('orders').find((o) => o.id === orderId)!;
const act = (stage: Stage) => stage === 'preparing' ? markPreparing(db.client, a, orderId) : stage === 'dispatched' ? markDispatched(db.client, a, orderId) : markDelivered(db.client, a, orderId);

describe('the transition matrix (every status × every stage → 200 or 409)', () => {
  for (const stage of Object.keys(STAGE_FROM) as Stage[]) {
    for (const from of OrderStatus) {
      const allowed = (STAGE_FROM[stage] as readonly string[]).includes(from);
      it(`${from} → ${stage}: ${allowed ? 'ok' : '409'}`, async () => {
        seed(from);
        const r = await act(stage);
        expect(r.ok).toBe(allowed);
        if (!r.ok) expect(r.status).toBe(409);
        expect(order().status).toBe(allowed ? stage : from);
      });
    }
  }
  it('another shop\'s order is 404, not 409', async () => {
    seed('confirmed');
    const r = await markPreparing(db.client, { merchantId: 'merchant-2' }, orderId);
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});

describe('the full chain', () => {
  beforeEach(() => seed('confirmed'));
  it('confirmed → preparing → dispatched → delivered leaves four history rows', async () => {
    expect((await markPreparing(db.client, a, orderId)).ok).toBe(true);
    expect((await markDispatched(db.client, a, orderId, { courier: 'TCS', trackingRef: 'TCS123', etaText: '2–3 din' })).ok).toBe(true);
    expect((await markDelivered(db.client, a, orderId)).ok).toBe(true);
    const rows = db.rows('order_status_history').filter((h) => h.order_id === orderId);
    expect(rows.map((h) => `${h.from_status}→${h.to_status}`)).toEqual(['draft→confirmed', 'confirmed→preparing', 'preparing→dispatched', 'dispatched→delivered']);
    expect(rows[2]).toMatchObject({ changed_by: 'agent', user_id: 'member-1', note: 'TCS · TCS123' });
    expect(order()).toMatchObject({ status: 'delivered', courier: 'TCS', tracking_ref: 'TCS123', eta_text: '2–3 din' });
  });
  it('a double-click on "preparing" acts once', async () => {
    const [first, second] = await Promise.all([markPreparing(db.client, a, orderId), markPreparing(db.client, a, orderId)]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(db.rows('order_status_history').filter((h) => h.to_status === 'preparing')).toHaveLength(1);
  });
});

describe('what the buyer hears at dispatch (FR-P4.2)', () => {
  it('window open: one free-form text with the courier and ETA, recorded in the chat', async () => {
    seed('preparing', true);
    await markDispatched(db.client, a, orderId, { courier: 'Leopards', etaText: 'Kal tak pohanch jaye ga' });
    expect(sent.texts).toHaveLength(1);
    expect(sent.texts[0]!.to).toBe('923001112222');
    expect(sent.texts[0]!.body).toContain('SK-1001 bhej diya gaya hai');
    expect(sent.texts[0]!.body).toContain('Courier: Leopards');
    expect(sent.texts[0]!.body).toContain('Kal tak');
    expect(order().pending_buyer_notice).toBeNull();
    expect(db.rows('messages').filter((m) => m.conversation_id === 'conv-1')).toHaveLength(1);
  });
  it('window closed: nothing is sent, the paid notice is set and the merchant is told', async () => {
    seed('preparing', false);
    await markDispatched(db.client, a, orderId, { courier: 'TCS' });
    expect(sent.texts).toHaveLength(0);
    expect(order().pending_buyer_notice).toBe('order_sent');
    expect(db.rows('notifications').some((n) => String(n.title).includes("Buyer's window closed"))).toBe(true);
  });
  it('dispatch details are trimmed and capped; blanks become null', async () => {
    seed('preparing');
    await markDispatched(db.client, a, orderId, { courier: '  TCS  ', trackingRef: '', etaText: 'x'.repeat(200) });
    expect(order().courier).toBe('TCS');
    expect(order().tracking_ref).toBeNull();
    expect(String(order().eta_text)).toHaveLength(80);
  });
});
