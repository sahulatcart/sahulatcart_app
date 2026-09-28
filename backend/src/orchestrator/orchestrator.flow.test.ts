// Whole conversations through the orchestrator: scripted intents in, WhatsApp replies and database rows
// out. The AI's phrasing is switched off (compose throws), so replies are the deterministic templates.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import type { Classification, DeliveryDetails } from '../llm';
import type { NormalizedMessage } from '../whatsapp/types';
import { runOrchestrator } from './orchestrator';
import { confirmCodOrder } from './order-service';
import { verifyPayment } from './payment-service';

const h = vi.hoisted(() => ({
  sent: [] as { to: string; body: string }[],
  next: {} as Record<string, unknown>, // the classification for the next message
  aiDown: false,
  delivery: { name: null, address: null, area: null, city: null, phone: null } as Record<string, string | null>,
}));

vi.mock('../llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../llm')>();
  const client = {
    classify: async () => {
      if (h.aiDown) throw new real.LlmUnavailableError('quota');
      return { productQuery: null, quantity: null, offerPaisa: null, offerScope: null, language: 'roman_urdu', ...h.next } as Classification;
    },
    compose: async () => { throw new real.LlmUnavailableError('phrasing off in tests'); },
    extractDelivery: async () => h.delivery as unknown as DeliveryDetails,
    transcribeAudio: async () => null,
    describeImage: async () => null,
  };
  return { ...real, getLlmClient: () => client };
});
vi.mock('../whatsapp/client', () => {
  let n = 0;
  const record = (to: string, body: string) => { h.sent.push({ to, body }); return { waMessageId: `wamid.${++n}` }; };
  return {
    sendText: async (_p: string, to: string, body: string) => record(to, body),
    sendImage: async (_p: string, to: string, _link: string, caption = '') => record(to, caption),
    sendDocument: async (_p: string, to: string, _link: string, file: string, caption?: string) => record(to, caption ?? file),
  };
});
vi.mock('../whatsapp/media', () => ({
  downloadWhatsAppMedia: async () => ({ buffer: Buffer.from('png'), mimeType: 'image/png' }),
  uploadScreenshot: async () => 'merchant/order/shot.png',
}));

const M = 'merchant-1';
const WA = '923001112222';
const ctx = { merchantId: M, conversationId: 'conversation-1', phoneNumberId: 'pn-1', customerId: 'customer-1', customerWaId: WA };
let db: FakeDb;
let seq = 0;

function shop(negotiation: Record<string, unknown> = {}) {
  db = new FakeDb();
  Object.assign(h, { sent: [], next: {}, aiDown: false });
  db.add('merchants', {
    id: M, business_name: 'Test Shop', bot_persona: {}, settings: { defaultDeliveryCharge: 20000 },
    negotiation_defaults: { maxDiscountPct: 20, concessionSteps: [0.5, 0.8, 1], roundsMax: 3, autoAcceptAtFloor: true, ...negotiation },
  });
  db.add('products', { id: 'mug', merchant_id: M, name: 'Coffee Mug', price: 80000, cost: null, negotiable: true, max_discount_pct: null, min_price: null, stock: 3, track_stock: true, is_active: true, description: null, attributes: {}, images: [] });
  db.add('customers', { id: ctx.customerId, merchant_id: M, wa_id: WA });
  db.add('conversations', { id: ctx.conversationId, merchant_id: M, customer_id: ctx.customerId, whatsapp_number_id: 'num-1', status: 'bot_active', current_state: 'greeting', context: {}, unread_count: 0, window_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  db.add('whatsapp_numbers', { id: 'num-1', merchant_id: M, phone_number_id: 'pn-1' });
  db.add('delivery_zones', { merchant_id: M, area_name: 'DHA Phase 5', charge: 15000, is_serviceable: true });
  db.add('delivery_zones', { merchant_id: M, area_name: 'Raiwind', charge: 0, is_serviceable: false });
  db.add('bank_accounts', { id: 'bank-1', merchant_id: M, bank_name: 'Meezan Bank', account_title: 'Test Shop', account_number: '0101-555', iban: null, is_default: true, is_active: true });
}

/** Send one buyer message; returns everything the bot sent back, joined. */
async function say(text: string, cls: Partial<Classification> = {}, type: 'text' | 'image' = 'text'): Promise<string> {
  h.next = cls;
  const from = h.sent.length;
  const id = `in.${++seq}`;
  const raw = { id, from: WA, type, ...(type === 'image' ? { image: { id: 'media-1' } } : {}) };
  await runOrchestrator(db.client, ctx, { waMessageId: id, from: WA, type, rawType: type, text: text || null, profileName: null, raw } as NormalizedMessage);
  return h.sent.slice(from).map((m) => m.body).join('\n');
}
const convo = () => db.rows('conversations')[0]!;
const order = () => db.rows('orders').at(-1)!;
const stock = () => db.rows('products').find((p) => p.id === 'mug')!.stock;
const dha = { name: 'Ali', address: 'House 5, Street 2', area: 'DHA Phase 5', city: 'Lahore', phone: null };

/** Quote → accept at list price → address in DHA Phase 5: ends at the payment question (Rs 800 + 150). */
async function toPayment(delivery: Record<string, string | null> = dha) {
  await say('coffee mug kitne ka hai', { intent: 'ask_price', productQuery: 'coffee mug' });
  await say('theek hai', { intent: 'accept' });
  h.delivery = delivery;
  return say('address bhej diya');
}

beforeEach(() => shop());

describe('order flow', () => {
  it('quotes, haggles down to a deal within the floor, takes the address and confirms COD once', async () => {
    expect(await say('coffee mug kitne ka hai', { intent: 'ask_price', productQuery: 'coffee mug' })).toContain('Rs 800');
    expect(await say('600 me de do', { intent: 'make_offer', offerPaisa: 60000 })).toContain('Rs 720'); // counter; floor is 640
    expect(await say('700 final', { intent: 'make_offer', offerPaisa: 70000 })).toContain('Rs 700'); // above the floor → deal
    expect(convo().current_state).toBe('collecting_delivery');

    h.delivery = dha;
    expect(await say('Ali, House 5 Street 2, DHA Phase 5')).toContain('Rs 850'); // 700 + DHA zone 150
    expect(await say('cash on delivery')).toContain('Order SK-1001 confirm');
    expect(order()).toMatchObject({ status: 'confirmed', payment_method: 'cod', order_number: 'SK-1001', total: 85000 });
    expect(stock()).toBe(2);

    // A second confirm of the same order (double "cod", retry) changes nothing.
    expect(await confirmCodOrder(db.client, { merchantId: M }, order().id, 'Test Shop')).toBeNull();
    expect(db.rows('payments')).toHaveLength(1);
    expect(stock()).toBe(2);
  });

  it('bank transfer: details, screenshot, merchant verifies once, buyer is told', async () => {
    await toPayment();
    const details = await say('bank transfer karunga');
    expect(details).toContain('Meezan Bank');
    expect(details).toContain('Rs 950');
    expect(order().status).toBe('awaiting_payment');
    expect(stock()).toBe(2); // held while awaiting payment

    expect(await say('', {}, 'image')).toContain('Screenshot mil gaya');
    expect(order().payment_status).toBe('claimed');

    expect(await verifyPayment(db.client, { merchantId: M }, order().id)).toEqual({ ok: true });
    expect(order()).toMatchObject({ status: 'paid', payment_status: 'verified' });
    expect(h.sent.at(-2)?.body).toContain('Payment mil gaya');
    expect(convo().current_state).toBe('completed');
    expect(await verifyPayment(db.client, { merchantId: M }, order().id)).toMatchObject({ ok: false, status: 409 });
  });

  it('cancelling a bank order from chat gives the stock back', async () => {
    await toPayment();
    await say('bank transfer');
    expect(stock()).toBe(2);
    expect(await say('order cancel kar do')).toContain('cancel kar diya');
    expect(order().status).toBe('cancelled');
    expect(stock()).toBe(3);
  });

  it('when the last unit sells meanwhile, checkout is cancelled instead of overselling', async () => {
    await toPayment();
    db.rows('products')[0]!.stock = 0;
    expect(await say('COD')).toContain('stock mein khatam');
    expect(order().status).toBe('cancelled');
    expect(db.rows('payments')).toHaveLength(0);
  });

  it('refuses an area the merchant does not serve, then accepts another address', async () => {
    expect(await toPayment({ ...dha, area: 'Raiwind' })).toContain('Raiwind mein abhi delivery nahi hoti');
    expect(convo().current_state).toBe('collecting_delivery');
    expect(db.rows('orders')).toHaveLength(0);
    h.delivery = dha;
    expect(await say('DHA Phase 5 bhej dein')).toContain('Rs 950');
  });

  it('a buyer with an Urdu-script name gets the text slip when payment is verified (no PDF)', async () => {
    await toPayment({ ...dha, name: 'علی' });
    await say('bank transfer');
    expect(order().slip_url ?? null).toBeNull();
    await verifyPayment(db.client, { merchantId: M }, order().id);
    const msg = h.sent.at(-1)!.body;
    expect(msg).toContain('Test Shop');
    expect(msg).toContain('علی');
  });

  it('outside the 24h window the buyer is not messaged; the merchant is told instead', async () => {
    await toPayment();
    await say('bank transfer');
    convo().window_expires_at = new Date(Date.now() - 1000).toISOString();
    const before = h.sent.length;
    await verifyPayment(db.client, { merchantId: M }, order().id);
    expect(h.sent.length).toBe(before);
    expect(db.rows('notifications').at(-1)?.title).toContain('Could not message the buyer');
  });
});

describe('guard rails', () => {
  it('hands the chat to the merchant when the AI is down', async () => {
    h.aiDown = true;
    expect(await say('assalam o alaikum')).toContain('team se connect');
    expect(convo().status).toBe('human_takeover');
    expect(db.rows('notifications').at(-1)?.body).toContain('AI is unavailable');
  });

  it('asks which product when a mention fits several', async () => {
    db.add('products', { merchant_id: M, name: 'T-Shirt', price: 150000, negotiable: false, stock: null, track_stock: false, is_active: true, images: [] });
    db.add('products', { merchant_id: M, name: 'Dress Shirt', price: 250000, negotiable: false, stock: null, track_stock: false, is_active: true, images: [] });
    expect(await say('shirt chahiye', { intent: 'ask_product', productQuery: 'shirt' })).toContain('Kaunsa chahiye: T-Shirt, Dress Shirt');
  });

  it('never agrees to more than is in stock', async () => {
    expect(await say('5 mug', { intent: 'ask_price', productQuery: 'coffee mug', quantity: 5 })).toContain('sirf 3 available');
  });

  it("stalemate 'hold_and_close' holds at the last price and still closes a later 'theek hai'", async () => {
    shop({ stalemateAction: 'hold_and_close', roundsMax: 1 });
    await say('mug?', { intent: 'ask_price', productQuery: 'coffee mug' });
    await say('500', { intent: 'make_offer', offerPaisa: 50000 }); // counter 720
    expect(await say('500', { intent: 'make_offer', offerPaisa: 50000 })).toContain('last price'); // final: floor 640
    expect(await say('500', { intent: 'make_offer', offerPaisa: 50000 })).toContain('Rs 640 hi best hai'); // hold, no handoff
    expect(convo().status).toBe('bot_active');
    expect(await say('theek hai', { intent: 'accept' })).toContain('Rs 640 final');
  });

  it("the default stalemate action hands off to the merchant", async () => {
    shop({ roundsMax: 1 });
    await say('mug?', { intent: 'ask_price', productQuery: 'coffee mug' });
    for (let i = 0; i < 3; i++) await say('500', { intent: 'make_offer', offerPaisa: 50000 });
    expect(convo().status).toBe('human_takeover');
  });

  it('checkout still works before migrations 0006/0008 are applied', async () => {
    delete db.rpcs.next_order_number;
    delete db.rpcs.reserve_stock;
    await toPayment();
    expect(await say('cash on delivery')).toContain('SK-1001'); // COUNT(*) fallback
    expect(stock()).toBe(3); // untracked, as before 0008
  });
});
