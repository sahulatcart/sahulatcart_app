// U1: the founders' read-only look inside a shop, through the real routes over FakeDb.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

vi.hoisted(() => { process.env.ADMIN_API_TOKEN = 'pilot-admin-token-for-tests'; });

const fake = { db: new FakeDb() };
const USERS: Record<string, { id: string; email: string; email_confirmed_at: string; user_metadata: Record<string, unknown> }> = {
  'jwt.fazal.sig': { id: 'user-fazal', email: 'fazal@sahulatcart.com', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.owner.sig': { id: 'user-owner', email: 'owner@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.staff.sig': { id: 'user-staff', email: 'staff@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
};
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.db.client,
  getAnonClient: () => ({ auth: { getUser: async (token: string) => (USERS[token] ? { data: { user: USERS[token] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) } }),
}));

let app: FastifyInstance;
beforeAll(async () => {
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

const jwt = (t: string) => ({ authorization: `Bearer ${t}` });
const fazal = jwt('jwt.fazal.sig');
const adminToken = { 'x-admin-token': 'pilot-admin-token-for-tests' };
let convoM1: string; let convoM2: string; let kurta: string;

function seed() {
  const db = fake.db;
  db.reset();
  db.add('merchants', { id: 'M1', business_name: 'Ali Store', owner_name: 'Ali', email: 'owner@shop.pk', phone: '923001111111', status: 'active', plan: 'basic', settings: { botEnabled: true, codEnabled: true }, bot_persona: { name: 'Sana', style: 'narm' }, negotiation_defaults: {}, business_hours: {} });
  db.add('merchants', { id: 'M2', business_name: 'Bilal Mobiles', email: 'bilal@shop.pk', phone: '923002222222', status: 'active', plan: 'pilot', settings: { botEnabled: true }, bot_persona: {}, negotiation_defaults: {} });
  db.add('merchant_users', { id: 'MU1', merchant_id: 'M1', auth_user_id: 'user-owner', email: 'owner@shop.pk', role: 'owner', is_active: true });
  db.add('merchant_users', { id: 'MU2', merchant_id: 'M1', auth_user_id: 'user-staff', email: 'staff@shop.pk', role: 'staff', is_active: true });
  db.add('platform_admins', { auth_user_id: 'user-fazal', email: 'fazal@sahulatcart.com', is_active: true });
  db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: 'PN1', phone_e164: '923001111111', status: 'connected', quality_rating: 'green', flag_reason: null });
  db.add('bank_accounts', { merchant_id: 'M1', bank_name: 'Meezan', account_title: 'Ali Store', account_number: '01234567890123', iban: 'PK00MEZN01234567890123', is_default: true, is_active: true });
  db.add('delivery_zones', { merchant_id: 'M1', area_name: 'Gulberg', city: 'Lahore', charge: 15000, is_serviceable: true, eta_text: null });
  db.add('subscriptions', { merchant_id: 'M1', plan: 'basic', status: 'active', current_period_start: '2026-10-01T00:00:00Z', current_period_end: '2026-11-01T00:00:00Z' });
  db.add('invoices', { merchant_id: 'M1', plan: 'basic', period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z', amount_paisa: 299900, status: 'paid' });
  const c1 = db.add('customers', { merchant_id: 'M1', wa_id: '923009990001', name: 'Ahmed', wa_opt_in_status: 'in', is_blocked: false });
  const c2 = db.add('customers', { merchant_id: 'M2', wa_id: '923009990002', name: 'Sara', wa_opt_in_status: 'in', is_blocked: false });
  convoM1 = db.add('conversations', { merchant_id: 'M1', customer_id: c1.id, status: 'bot_active', current_state: 'browsing', unread_count: 3, last_message_at: new Date().toISOString(), context: {} }).id;
  convoM2 = db.add('conversations', { merchant_id: 'M2', customer_id: c2.id, status: 'bot_active', current_state: 'browsing', unread_count: 3, last_message_at: new Date().toISOString(), context: {} }).id;
  for (const [conv, mid] of [[convoM1, 'M1'], [convoM2, 'M2']] as const) {
    db.add('messages', { conversation_id: conv, merchant_id: mid, direction: 'inbound', sender: 'customer', type: 'text', body: 'salam', status: 'delivered' });
    db.add('messages', { conversation_id: conv, merchant_id: mid, direction: 'outbound', sender: 'bot', type: 'text', body: 'Walaikum salam!', status: 'sent' });
  }
  db.add('orders', { merchant_id: 'M1', customer_id: c1.id, order_number: 'SK-1001', status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending', total: 85000, delivery_name: 'Ahmed', created_at: new Date().toISOString() });
  db.add('orders', { merchant_id: 'M1', customer_id: c1.id, order_number: null, status: 'draft', payment_method: 'unset', payment_status: 'unpaid', total: 0 });
  db.add('orders', { merchant_id: 'M2', customer_id: c2.id, order_number: 'SK-2001', status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending', total: 5000, created_at: new Date().toISOString() });
  kurta = db.add('products', { merchant_id: 'M1', name: 'Kurta', price: 150000, cost: 90000, is_active: true, negotiable: true, max_discount_pct: null, min_price: null, deleted_at: null, images: ['M1/kurta/a.png'] }).id;
  db.add('products', { merchant_id: 'M1', name: 'Gone', price: 100, cost: 50, is_active: false, deleted_at: '2026-10-10T00:00:00Z', images: [] });
  db.add('products', { merchant_id: 'M2', name: 'Charger', price: 50000, cost: null, is_active: true, deleted_at: null, images: [] });
}
beforeEach(seed);

const audits = () => fake.db.rows('audit_log').filter((a) => a.action === 'platform_view');
const convo = (id: string) => fake.db.rows('conversations').find((c) => c.id === id)!;

describe('GET /api/v1/platform/merchants/:id', () => {
  it('returns the whole picture of one shop, never a bank account number, and records the look', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: fazal });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.merchant).toMatchObject({ id: 'M1', business_name: 'Ali Store', plan: 'basic', status: 'active' });
    expect(Object.keys(b.readiness.steps)).toHaveLength(7);
    expect(b.connection.status).toBe('connected');
    expect(b.botMode.mode).toBe('sell');
    expect(b.limits).toEqual({ conversations: 1000 });
    expect(b.conversationsThisMonth).toBe(1);
    expect(b.subscription).toMatchObject({ status: 'active', plan: 'basic' });
    expect(b.invoices).toHaveLength(1);
    expect(b.members.map((u: { role: string }) => u.role).sort()).toEqual(['owner', 'staff']);
    expect(b.bankAccounts[0]).toMatchObject({ bank_name: 'Meezan', is_default: true });
    expect(b.zones[0]).toMatchObject({ area_name: 'Gulberg', charge: 15000 });
    expect(b.usage).toMatchObject({ outbound: 0, freeQuota: 1000 });
    expect(r.body).not.toContain('01234567890123');
    expect(r.body).not.toContain('PK00MEZN');
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ merchant_id: 'M1', actor: 'platform', entity: 'merchant', entity_id: 'M1', user_id: 'user-fazal', diff: {} });
  });
  it('an unknown id is 404 on every route', async () => {
    for (const url of ['/api/v1/platform/merchants/nope', '/api/v1/platform/merchants/nope/orders', '/api/v1/platform/merchants/nope/conversations', `/api/v1/platform/merchants/nope/conversations/${convoM1}`, '/api/v1/platform/merchants/nope/products']) {
      expect((await app.inject({ method: 'GET', url, headers: fazal })).statusCode, url).toBe(404);
    }
    expect(audits()).toHaveLength(0);
  });
  it('the pilot token works too, with a null user on the audit row', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: adminToken });
    expect(r.statusCode).toBe(200);
    expect(audits()[0]!.user_id).toBeNull();
  });
});

describe('orders, chats and catalog of one shop', () => {
  it('orders: only placed orders of that shop, with the status filter', async () => {
    let r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1/orders', headers: fazal });
    expect(r.json().orders.map((o: { order_number: string }) => o.order_number)).toEqual(['SK-1001']);
    r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1/orders?status=cancelled', headers: fazal });
    expect(r.json().orders).toEqual([]);
  });
  it('conversations: that shop only, with the customer embedded', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1/conversations', headers: fazal });
    expect(r.json().conversations).toHaveLength(1);
    expect(r.json().conversations[0]).toMatchObject({ id: convoM1, customers: { name: 'Ahmed', wa_id: '923009990001' } });
  });
  it("a chat read returns the messages oldest first, leaves unread_count alone, records the look; another shop's chat is 404", async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/platform/merchants/M1/conversations/${convoM1}`, headers: fazal });
    expect(r.statusCode).toBe(200);
    expect(r.json().messages.map((m: { body: string }) => m.body)).toEqual(['salam', 'Walaikum salam!']);
    expect(convo(convoM1).unread_count).toBe(3);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ entity: 'conversation', entity_id: convoM1, merchant_id: 'M1' });
    const other = await app.inject({ method: 'GET', url: `/api/v1/platform/merchants/M1/conversations/${convoM2}`, headers: fazal });
    expect(other.statusCode).toBe(404);
    expect(audits()).toHaveLength(1);
  });
  it('products: that shop only, deleted rows absent, cost present, thumbnail resolved', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1/products', headers: fazal });
    const ps = r.json().products;
    expect(ps.map((p: { name: string }) => p.name)).toEqual(['Kurta']);
    expect(ps[0].cost).toBe(90000);
    expect(ps[0].thumbnailUrl).toContain('M1/kurta/a.png');
  });
});

describe('who may look', () => {
  it('an owner, staff and an anonymous caller are refused; nothing is recorded', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: jwt('jwt.owner.sig') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: jwt('jwt.staff.sig') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1' })).statusCode).toBe(401);
    expect(audits()).toHaveLength(0);
  });
});

describe('fail closed when the look cannot be recorded (review follow-up)', () => {
  // The route holds the FakeDb instance itself as its client, so patching from() on it reaches the route.
  function breakAuditLog(): () => void {
    const db = fake.db as unknown as { from: (t: string) => unknown };
    const orig = db.from.bind(fake.db);
    db.from = (t: string) => (t === 'audit_log' ? { insert: async () => ({ data: null, error: { code: '57P01', message: 'terminating connection' } }) } : orig(t));
    return () => { db.from = orig; };
  }

  it('the shop detail answers 503 and shows none of the shop', async () => {
    const restore = breakAuditLog();
    try {
      const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: fazal });
      expect(r.statusCode).toBe(503);
      expect(r.json().error.code).toBe('AUDIT_UNAVAILABLE');
      expect(r.body).not.toContain('Ali Store');
      expect(r.body).not.toContain('Gulberg');
    } finally { restore(); }
  });

  it('a chat read answers 503 and shows no message', async () => {
    const restore = breakAuditLog();
    try {
      const r = await app.inject({ method: 'GET', url: `/api/v1/platform/merchants/M1/conversations/${convoM1}`, headers: fazal });
      expect(r.statusCode).toBe(503);
      expect(r.body).not.toContain('salam');
      expect(convo(convoM1).unread_count).toBe(3);
    } finally { restore(); }
  });

  it('once the audit log works again the same reads succeed and are recorded', async () => {
    breakAuditLog()();
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: fazal })).statusCode).toBe(200);
    expect(audits()).toHaveLength(1);
  });
});

describe('console critique follow-ups (2026-10-14)', () => {
  it('the detail says whether the bot sells, what a suspension would interrupt, the section counts and the plan prices', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: fazal });
    const b = r.json();
    expect(b.selling).toEqual({ selling: true, code: 'selling', reason: null });
    expect(b.impact).toEqual({ liveChats: 1, midCheckout: 0 });
    expect(b.counts).toEqual({ orders: 1, chats: 1, products: 1 }); // the draft order and the deleted product do not count
    expect(b.plans.map((p: { id: string }) => p.id)).toEqual(['pilot', 'basic', 'pro']);
    convo(convoM1).current_state = 'awaiting_payment_proof';
    const r2 = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: fazal });
    expect(r2.json().impact).toEqual({ liveChats: 1, midCheckout: 1 });
    fake.db.rows('whatsapp_numbers')[0]!.status = 'needs_attention';
    fake.db.rows('whatsapp_numbers')[0]!.flag_reason = 'policy';
    const r3 = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1', headers: fazal });
    expect(r3.json().selling).toMatchObject({ selling: false, code: 'policy' });
  });

  it("a chat read carries that chat's negotiations: list, floor and both offers, with the product name", async () => {
    fake.db.add('negotiations', { conversation_id: convoM1, merchant_id: 'M1', product_id: kurta, quantity: 1, list_price: 150000, floor_price: 135000, rounds: 2, last_bot_offer: 140000, last_customer_offer: 120000, agreed_price: null, status: 'ongoing' });
    fake.db.add('negotiations', { conversation_id: convoM2, merchant_id: 'M2', product_id: null, quantity: 1, list_price: 5000, floor_price: 4500, rounds: 1, status: 'ongoing' });
    const r = await app.inject({ method: 'GET', url: `/api/v1/platform/merchants/M1/conversations/${convoM1}`, headers: fazal });
    const n = r.json().negotiations;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ productName: 'Kurta', list_price: 150000, floor_price: 135000, last_bot_offer: 140000, last_customer_offer: 120000, status: 'ongoing' });
    expect(n[0]).not.toHaveProperty('products');
  });

  it("the catalog shows each product's floor exactly as the engine computes it for one unit", async () => {
    fake.db.rows('merchants').find((m) => m.id === 'M1')!.negotiation_defaults = { maxDiscountPct: 10 };
    fake.db.add('products', { merchant_id: 'M1', name: 'Shawl', price: 200000, cost: null, is_active: true, negotiable: true, max_discount_pct: null, min_price: 150000, deleted_at: null, images: [] });
    fake.db.add('products', { merchant_id: 'M1', name: 'Fixed Cap', price: 50000, cost: null, is_active: true, negotiable: false, max_discount_pct: null, min_price: null, deleted_at: null, images: [] });
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants/M1/products', headers: fazal });
    const floor = (name: string) => (r.json().products as { name: string; floor: number }[]).find((p) => p.name === name)!.floor;
    expect(floor('Kurta')).toBe(135000); // list less the shop's 10%
    expect(floor('Shawl')).toBe(150000); // an absolute min_price wins over the percentage
    expect(floor('Fixed Cap')).toBe(50000); // not negotiable: the list price
  });
});
