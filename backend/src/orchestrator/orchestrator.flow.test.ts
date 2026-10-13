// Whole conversations through the orchestrator: scripted intents in, WhatsApp replies and database rows
// out. The AI's phrasing is switched off (compose throws), so replies are the deterministic templates.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import type { Classification, DeliveryDetails } from '../llm';
import type { NormalizedMessage } from '../whatsapp/types';
import { runOrchestrator } from './orchestrator';
import { confirmCodOrder } from './order-service';
import { notifyBuyerNow, rejectPayment, verifyPayment } from './payment-service';

const h = vi.hoisted(() => ({
  sent: [] as { to: string; body: string; type?: string; buttons?: string[]; template?: string; params?: string[] }[],
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
  const record = (to: string, body: string, extra: Record<string, unknown> = {}) => { h.sent.push({ to, body, ...extra }); return { waMessageId: `wamid.${++n}` }; };
  return {
    sendText: async (_p: string, to: string, body: string) => record(to, body, { type: 'text' }),
    sendImage: async (_p: string, to: string, _link: string, caption = '') => record(to, caption, { type: 'image' }),
    sendDocument: async (_p: string, to: string, _link: string, file: string, caption?: string) => record(to, caption ?? file, { type: 'document' }),
    sendTemplate: async (_p: string, to: string, name: string, params: string[]) => record(to, params.join(' | '), { type: 'template', template: name, params }),
    sendButtons: async (_p: string, to: string, body: string, buttons: { id: string; title: string }[]) => record(to, body, { type: 'interactive', buttons: buttons.map((b) => b.id) }),
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
/** The buyer taps a reply button (Meta sends the title as text and the id in the raw payload). */
async function tap(id: string, title: string): Promise<string> {
  h.next = {};
  const from = h.sent.length;
  const mid = `in.${++seq}`;
  const raw = { id: mid, from: WA, type: 'interactive', interactive: { button_reply: { id, title } } };
  await runOrchestrator(db.client, ctx, { waMessageId: mid, from: WA, type: 'interactive', rawType: 'interactive', text: title, profileName: null, raw } as NormalizedMessage);
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
    expect(h.sent.at(-1)?.body).toContain('Payment mil gaya'); // one send: the PDF with the text as caption (M4)
    expect(h.sent.at(-1)?.type).toBe('document');
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
    expect(db.rows('notifications').at(-1)?.title).toContain("window closed"); // M4: a paid notice waits on the order page
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

  it('if no order number can be allocated, checkout stops instead of guessing one', async () => {
    delete db.rpcs.next_order_number;
    await toPayment();
    await say('cash on delivery');
    expect(order().status).toBe('draft');
    expect(db.rows('payments')).toHaveLength(0);
  });

  it('if stock reservation fails, checkout stops and the order goes back to draft', async () => {
    delete db.rpcs.reserve_stock;
    await toPayment();
    expect(await say('cash on delivery')).not.toContain('SK-1001');
    expect(order().status).toBe('draft');
    expect(order().order_number).toBeNull();
    expect(db.rows('payments')).toHaveLength(0);
    expect(stock()).toBe(3);
  });
});

describe('M4: fewer messages, buttons, the window rule', () => {
  it('the payment question is two buttons when a bank account exists, and a tap on COD confirms', async () => {
    await toPayment();
    const ask = h.sent.at(-1)!;
    expect(ask.type).toBe('interactive');
    expect(ask.buttons).toEqual(['pay_cod', 'pay_bank']);
    expect(ask.body).toContain('Cash on Delivery');
    expect(await tap('pay_cod', 'Cash on Delivery')).toContain('SK-1001');
    expect(order().payment_method).toBe('cod');
  });

  it('a tap on Bank Transfer sends ONE message with the details and the screenshot ask', async () => {
    await toPayment();
    const before = h.sent.length;
    const out = await tap('pay_bank', 'Bank Transfer');
    expect(h.sent.length - before).toBe(1);
    expect(out).toContain('Meezan Bank');
    expect(out).toContain('screenshot');
    expect(convo().current_state).toBe('awaiting_payment_proof');
  });

  it('typed "bank transfer" still sends one message (baseline was two)', async () => {
    await toPayment();
    const before = h.sent.length;
    await say('bank transfer');
    expect(h.sent.length - before).toBe(1);
  });

  it('without a bank account the question is plain text', async () => {
    db.rows('bank_accounts')[0]!.is_active = false;
    await toPayment();
    expect(h.sent.at(-1)!.type).toBe('text');
  });

  it('a COD confirmation without a PDF is one message (baseline was two)', async () => {
    await toPayment({ ...dha, name: 'علی' });
    const before = h.sent.length;
    await say('cash on delivery');
    expect(h.sent.length - before).toBe(1);
    expect(h.sent.at(-1)!.body).toContain('SK-1001');
  });

  it('payment verified inside the window: one free-form message (the slip PDF carries the text)', async () => {
    await toPayment();
    await say('bank transfer');
    await say('', {}, 'image');
    const before = h.sent.length;
    await verifyPayment(db.client, { merchantId: M }, order().id);
    expect(h.sent.length - before).toBe(1);
    expect(h.sent.at(-1)!.type).toBe('document');
    expect(h.sent.at(-1)!.body).toContain('Payment mil gaya');
    expect(order().pending_buyer_notice ?? null).toBeNull();
  });

  it('payment verified after the window closed: nothing sent, the order waits for the paid button', async () => {
    await toPayment();
    await say('bank transfer');
    await say('', {}, 'image');
    convo().window_expires_at = new Date(Date.now() - 60_000).toISOString();
    const before = h.sent.length;
    await verifyPayment(db.client, { merchantId: M }, order().id);
    expect(h.sent.length).toBe(before);
    expect(order().pending_buyer_notice).toBe('payment_update');
    const n = db.rows('notifications').at(-1)!;
    expect(n.title).toContain("window closed");
    expect(n.data.action).toBe('payment_update');
    expect(n.body).toContain('Rs 4');
  });

  it('the paid button sends the approved template with the order params and clears the notice', async () => {
    await toPayment({ ...dha, name: 'Ali' });
    await say('bank transfer');
    await say('', {}, 'image');
    convo().window_expires_at = new Date(Date.now() - 60_000).toISOString();
    await verifyPayment(db.client, { merchantId: M }, order().id);
    expect((await notifyBuyerNow(db.client, { merchantId: M }, order().id, 'payment_update'))).toMatchObject({ ok: false, code: 'template_not_approved' });
    db.add('message_templates', { merchant_id: M, waba_id: 'W', name: 'payment_update', language: 'en', status: 'approved', rejection_reason: null, wa_template_id: 't1' });
    const r = await notifyBuyerNow(db.client, { merchantId: M }, order().id, 'payment_update');
    expect(r).toMatchObject({ ok: true, template: 'payment_update' });
    const s = h.sent.at(-1)!;
    expect(s.type).toBe('template');
    expect(s.params).toEqual(['Ali', 'SK-1001', 'verify ho gayi hai', 'Jald deliver karenge, shukriya!']);
    expect(order().pending_buyer_notice).toBeNull();
    expect(db.rows('messages').at(-1)).toMatchObject({ type: 'template', template_name: 'payment_update', sender: 'system' });
  });

  it('a rejection after the window closed uses the same template with the reason', async () => {
    await toPayment({ ...dha, name: 'Ali' });
    await say('bank transfer');
    await say('', {}, 'image');
    convo().window_expires_at = new Date(Date.now() - 60_000).toISOString();
    await rejectPayment(db.client, { merchantId: M }, order().id, 'amount short');
    expect(order().pending_buyer_notice).toBe('payment_update');
    db.add('message_templates', { merchant_id: M, waba_id: 'W', name: 'payment_update_v2', language: 'en', status: 'approved', rejection_reason: null });
    const r = await notifyBuyerNow(db.client, { merchantId: M }, order().id, 'payment_update');
    expect(r).toMatchObject({ ok: true, template: 'payment_update_v2' });
    expect(h.sent.at(-1)!.params![2]).toBe('verify nahi ho saki');
    expect(h.sent.at(-1)!.params![3]).toContain('amount short');
  });

  it('the paid button refuses an order from another merchant and an unplaced order', async () => {
    await toPayment();
    expect(await notifyBuyerNow(db.client, { merchantId: 'someone-else' }, order().id, 'payment_update')).toMatchObject({ ok: false, status: 404 });
    expect(await notifyBuyerNow(db.client, { merchantId: M }, order().id, 'order_sent')).toMatchObject({ ok: false, code: 'NOT_PLACED' });
  });
});

describe('P2: only the payment methods the merchant enabled; the greeting', () => {
  const everyDay = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '10:00', close: '22:00' }]));
  const merchant = () => db.rows('merchants')[0]!;

  it('COD off: no question — one message with the bank details, straight to the screenshot wait', async () => {
    merchant().settings.codEnabled = false;
    const out = await toPayment();
    expect(h.sent.at(-1)!.type).toBe('text');
    expect(out).toContain('bank transfer se hogi');
    expect(out).toContain('Meezan Bank');
    expect(out).toContain('screenshot');
    expect(convo().current_state).toBe('awaiting_payment_proof');
    expect(order().payment_method).toBe('bank_transfer');
  });

  it('COD off: "cash on delivery" while waiting for the screenshot does not switch the order', async () => {
    merchant().settings.codEnabled = false;
    await toPayment();
    const out = await say('cash on delivery kar dein');
    expect(out).toContain('Cash on Delivery available nahi');
    expect(order().payment_method).toBe('bank_transfer');
    expect(convo().current_state).toBe('awaiting_payment_proof');
  });

  it('COD only: the question asks to confirm, and a plain "haan" places the COD order', async () => {
    db.rows('bank_accounts')[0]!.is_active = false;
    const ask = await toPayment();
    expect(ask).toContain('haan');
    expect(ask).not.toContain('bank transfer');
    expect(await say('haan')).toContain('SK-1001');
    expect(order().payment_method).toBe('cod');
  });

  it('COD only: asking for bank transfer is refused with the COD line, and the order waits', async () => {
    db.rows('bank_accounts')[0]!.is_active = false;
    await toPayment();
    expect(await say('bank transfer')).toContain('sirf Cash on Delivery');
    expect(convo().current_state).toBe('selecting_payment');
  });

  it('neither method: the chat goes to the merchant instead of trapping the buyer', async () => {
    merchant().settings.codEnabled = false;
    db.rows('bank_accounts')[0]!.is_active = false;
    await toPayment();
    expect(convo().status).toBe('human_takeover');
    expect(db.rows('notifications').some((n) => String(n.body).includes('No payment method'))).toBe(true);
  });

  it('the merchant\'s payment note appears under the bank details', async () => {
    merchant().settings.paymentInstructions = 'JazzCash bhi chalta hai: 0300-1234567';
    await toPayment();
    const out = await say('bank transfer');
    expect(out).toContain('JazzCash bhi chalta hai');
  });

  it('a greeting uses the merchant\'s own line and today\'s hours', async () => {
    merchant().bot_persona = { greeting: 'Khush aamdeed Test Shop mein!' };
    merchant().business_hours = everyDay;
    const out = await say('salam', { intent: 'greet' });
    expect(out).toContain('Khush aamdeed Test Shop mein!');
    expect(out).toContain('Hum aaj 10:00–22:00 khule hain');
  });

  it('without a greeting or hours, the default greeting is unchanged', async () => {
    const out = await say('salam', { intent: 'greet' });
    expect(out).toBe('Assalam-o-Alaikum! Kaise madad kar sakta hoon?');
  });
});

describe('M5: the message meter and the AI budget', () => {
  const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' }).format(new Date());
  const usage = () => db.rows('message_usage').find((u) => u.phone_number_id === 'pn-1');
  /** Set this month's counters, on the row the AI charges may already have created (one row per number per month). */
  const setUsage = (patch: Record<string, number>) => {
    const row = usage() ?? db.add('message_usage', { merchant_id: M, phone_number_id: 'pn-1', period_month: month(), outbound_count: 0, inbound_count: 0, llm_calls: 0, llm_calls_day: db.karachiToday });
    Object.assign(row, patch);
  };

  it('inbound and outbound are not counted here (the client mock bypasses the meter), but AI calls are', async () => {
    await say('mug?', { intent: 'ask_price', productQuery: 'coffee mug' });
    expect(usage()?.llm_calls).toBeGreaterThanOrEqual(1); // classify counted; compose throws in tests before counting matters
  });

  it('past the daily AI cap a new message is handed to the merchant, like an outage', async () => {
    db.rows('merchants')[0]!.settings = { ...db.rows('merchants')[0]!.settings, llmDailyCap: 100 };
    setUsage({ llm_calls: 100 });
    expect(await say('assalam o alaikum')).toContain('team se connect');
    expect(convo().status).toBe('human_takeover');
    expect(db.rows('notifications').at(-1)?.body).toContain('AI is unavailable');
  });

  it('after the free 1,000 with "hand off": a new chat is handed over, a buyer mid-checkout finishes', async () => {
    // A buyer already at the payment step first.
    await toPayment();
    db.rows('merchants')[0]!.settings = { ...db.rows('merchants')[0]!.settings, afterFreeQuota: 'handoff' };
    setUsage({ outbound_count: 1000 });
    expect(await tap('pay_cod', 'Cash on Delivery')).toContain('SK-1001'); // checkout finishes
    expect(convo().status).toBe('bot_active');
    // The next, new conversation (state completed → fresh) is handed over.
    expect(await say('salam, mug hai?', { intent: 'ask_price', productQuery: 'coffee mug' })).toContain('team se connect');
    expect(convo().status).toBe('human_takeover');
    expect(db.rows('notifications').at(-1)?.body).toContain('free 1000');
  });

  it('with "continue" (the default) the bot keeps selling past the free messages', async () => {
    setUsage({ outbound_count: 5000 });
    expect(await say('mug?', { intent: 'ask_price', productQuery: 'coffee mug' })).toContain('Rs 800');
    expect(convo().status).toBe('bot_active');
  });
});

describe('go-live: the owner can test while the bot is off; a plain yes places a COD order, a qualified one does not', () => {
  it("bot off: buyers get silence, the owner's own phone still gets the bot (the test order for step 7)", async () => {
    db.rows('merchants')[0]!.settings = { ...db.rows('merchants')[0]!.settings, botEnabled: false };
    db.rows('merchants')[0]!.phone = '+92 ' + WA.slice(2); // the owner's phone, saved in a different format
    const before = h.sent.length;
    // A stranger: stored, no reply.
    await runOrchestrator(db.client, ctx, { waMessageId: 'in.x', from: '923009999999', type: 'text', rawType: 'text', text: 'salam', profileName: null, raw: { id: 'in.x', from: '923009999999', type: 'text' } } as NormalizedMessage);
    expect(h.sent.length).toBe(before);
    // The owner, from the phone on the shop profile: the bot answers and an order can be placed.
    expect(await say('mug?', { intent: 'ask_price', productQuery: 'coffee mug' })).toContain('Rs 800');
    await toPayment();
    await tap('pay_cod', 'Cash on Delivery');
    expect(order().status).toBe('confirmed');
  });

  it('COD-only shop: "haan" confirms, "ji nahi" / "ok pehle size batao" / "han lekin kitne din?" do not', async () => {
    db.rows('bank_accounts')[0]!.is_active = false;
    await toPayment();
    expect(h.sent.at(-1)!.type).toBe('text');
    await say('ji nahi');
    await say('ok pehle size batao');
    await say('han lekin kitne din?');
    expect(order().status).toBe('draft');
    expect(convo().current_state).toBe('selecting_payment');
    expect(await say('haan')).toContain('SK-1001');
    expect(order().status).toBe('confirmed');
  });
});

describe('M6: suspension', () => {
  it('a suspended shop stores the message and never replies', async () => {
    db.rows('merchants')[0]!.status = 'suspended';
    const before = h.sent.length;
    await say('salam', { intent: 'greet' });
    expect(h.sent.length).toBe(before);
    expect(convo().current_state).toBe('greeting');
  });
});
