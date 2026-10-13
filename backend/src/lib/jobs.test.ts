// The unpaid-order expiry job (P4, FR-P4.3/4.4) over FakeDb.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { expireUnpaidOrders, unpaidExpiryHours } from './jobs';

const sent = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock('../whatsapp/client', () => ({
  sendText: async (_p: string, _to: string, body: string) => { sent.texts.push(body); return { waMessageId: `wamid.${sent.texts.length}` }; },
  sendDocument: async () => ({ waMessageId: null }),
  sendTemplate: async () => ({ waMessageId: null }),
}));

const NOW = new Date('2026-10-14T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
let db: FakeDb;

/** A bank-transfer order with one reserved unit of a tracked product. The buyer window is judged on the real clock. */
function bankOrder(merchantId: string, placedHoursAgo: number, opts: { windowOpen?: boolean; claimed?: boolean; status?: string } = {}) {
  const cust = db.add('customers', { merchant_id: merchantId, wa_id: `92300${Math.floor(Math.random() * 1e7)}` });
  const conv = db.add('conversations', { merchant_id: merchantId, customer_id: cust.id, whatsapp_number_id: 'num-1', window_expires_at: new Date(Date.now() + (opts.windowOpen === false ? -1 : 1) * 3_600_000).toISOString(), current_state: 'awaiting_payment_proof', context: {} });
  const o = db.add('orders', { merchant_id: merchantId, customer_id: cust.id, conversation_id: conv.id, order_number: `SK-${db.rows('orders').length + 1001}`, status: opts.status ?? 'awaiting_payment', payment_method: 'bank_transfer', payment_status: 'unpaid', placed_at: ago(placedHoursAgo), stock_reserved: true, slip_url: null, delivery_name: 'Ali' });
  conv.context = { pendingOrderId: o.id };
  db.add('order_items', { order_id: o.id, product_id: 'kurta', quantity: 1 });
  if (opts.claimed) db.add('payment_claims', { order_id: o.id, merchant_id: merchantId, status: 'pending' });
  return o;
}
const stock = () => db.rows('products').find((p) => p.id === 'kurta')!.stock;
const status = (id: string) => db.rows('orders').find((o) => o.id === id)!.status;

beforeEach(() => {
  db = new FakeDb();
  sent.texts = [];
  db.add('merchants', { id: 'M', business_name: 'Shop', settings: {} });
  db.add('merchants', { id: 'M6', business_name: 'Quick shop', settings: { unpaidExpiryHours: 6 } });
  db.add('whatsapp_numbers', { id: 'num-1', merchant_id: 'M', phone_number_id: 'pn-1' });
  db.add('products', { id: 'kurta', merchant_id: 'M', name: 'Kurta', track_stock: true, stock: 0 });
});

describe('unpaidExpiryHours', () => {
  it('defaults to 24 and ignores values outside 6–72', () => {
    expect(unpaidExpiryHours({})).toBe(24);
    expect(unpaidExpiryHours({ unpaidExpiryHours: 12 })).toBe(12);
    expect(unpaidExpiryHours({ unpaidExpiryHours: 3 })).toBe(24);
    expect(unpaidExpiryHours({ unpaidExpiryHours: '12' })).toBe(24);
    expect(unpaidExpiryHours(null)).toBe(24);
  });
});

describe('expireUnpaidOrders', () => {
  it('cancels a bank order with no screenshot after 24 h: stock back, history, merchant told, buyer told while the window is open', async () => {
    const old = bankOrder('M', 25);
    const fresh = bankOrder('M', 2);
    const done = await expireUnpaidOrders(db.client, NOW);
    expect(done).toEqual([old.id]);
    expect(status(old.id)).toBe('cancelled');
    expect(status(fresh.id)).toBe('awaiting_payment');
    expect(db.rows('orders').find((o) => o.id === old.id)!.cancelled_reason).toBe('payment not received in 24h');
    expect(stock()).toBe(1);
    expect(db.rows('order_status_history').find((h) => h.order_id === old.id)).toMatchObject({ from_status: 'awaiting_payment', to_status: 'cancelled', changed_by: 'system' });
    expect(db.rows('notifications').some((n) => String(n.title).includes('expired unpaid'))).toBe(true);
    expect(sent.texts).toHaveLength(1);
    expect(sent.texts[0]).toContain('cancel ho gaya');
    expect(db.rows('conversations').find((c) => c.context.pendingOrderId === old.id)!.current_state).toBe('completed');
  });

  it('a claimed order (screenshot waiting for review) is never touched, however old', async () => {
    const claimed = bankOrder('M', 60, { claimed: true });
    expect(await expireUnpaidOrders(db.client, NOW)).toEqual([]);
    expect(status(claimed.id)).toBe('awaiting_payment');
    expect(stock()).toBe(0);
  });

  it('uses each merchant\'s own hours', async () => {
    const quick = bankOrder('M6', 7);
    const slow = bankOrder('M', 7);
    expect(await expireUnpaidOrders(db.client, NOW)).toEqual([quick.id]);
    expect(status(slow.id)).toBe('awaiting_payment');
  });

  it('says nothing to a buyer whose window has closed — no paid notice, no merchant nag', async () => {
    const old = bankOrder('M', 30, { windowOpen: false });
    await expireUnpaidOrders(db.client, NOW);
    expect(status(old.id)).toBe('cancelled');
    expect(sent.texts).toHaveLength(0);
    expect(db.rows('orders').find((o) => o.id === old.id)!.pending_buyer_notice).toBeUndefined();
    expect(db.rows('notifications').filter((n) => String(n.title).includes('window closed'))).toHaveLength(0);
  });

  it('a second run changes nothing (idempotent)', async () => {
    bankOrder('M', 25);
    expect(await expireUnpaidOrders(db.client, NOW)).toHaveLength(1);
    expect(await expireUnpaidOrders(db.client, NOW)).toEqual([]);
    expect(stock()).toBe(1);
    expect(db.rows('order_status_history')).toHaveLength(1);
  });

  it('ignores orders that were paid or confirmed by COD', async () => {
    const paid = bankOrder('M', 40, { status: 'paid' });
    expect(await expireUnpaidOrders(db.client, NOW)).toEqual([]);
    expect(status(paid.id)).toBe('paid');
  });
});
