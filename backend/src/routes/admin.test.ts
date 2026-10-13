// P6 (FR-P6.5): the admin API through the real server over FakeDb — auth, cross-tenant isolation,
// manager-only routes, the per-minute rate limits (FR-P6.3) and the per-IP admin-token lockout (FR-P6.4).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';
import { _resetAdminTokenFails, isAdminToken } from '../lib/auth';
import { bucketFor, exempt } from '../lib/rate-limit';

vi.hoisted(() => { process.env.ADMIN_API_TOKEN = 'pilot-admin-token-for-tests'; });

const fake = new FakeDb();
const USERS: Record<string, { id: string; email: string; user_metadata: Record<string, unknown> }> = {
  'jwt.owner.sig': { id: 'u-owner', email: 'owner@a.pk', user_metadata: {} },
  'jwt.staff.sig': { id: 'u-staff', email: 'staff@a.pk', user_metadata: {} },
  'jwt.ownerb.sig': { id: 'u-ownerb', email: 'owner@b.pk', user_metadata: {} },
  'jwt.noshop.sig': { id: 'u-noshop', email: 'nobody@x.pk', user_metadata: {} },
};
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.client,
  getAnonClient: () => ({
    auth: { getUser: async (token: string) => (USERS[token] ? { data: { user: USERS[token] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
  }),
}));

let app: FastifyInstance;
const jwt = (t: string) => ({ authorization: `Bearer ${t}` });
const A = jwt('jwt.owner.sig'); const STAFF = jwt('jwt.staff.sig'); const B = jwt('jwt.ownerb.sig');
let orderA: string; let productA: string; let convoA: string;

beforeAll(async () => {
  fake.add('merchants', { id: 'MA', business_name: 'Shop A', status: 'active', settings: {}, negotiation_defaults: {}, bot_persona: {} });
  fake.add('merchants', { id: 'MB', business_name: 'Shop B', status: 'active', settings: {}, negotiation_defaults: {}, bot_persona: {} });
  fake.add('merchant_users', { id: 'mu-a', merchant_id: 'MA', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'owner@a.pk' });
  fake.add('merchant_users', { id: 'mu-s', merchant_id: 'MA', auth_user_id: 'u-staff', role: 'staff', is_active: true, email: 'staff@a.pk' });
  fake.add('merchant_users', { id: 'mu-b', merchant_id: 'MB', auth_user_id: 'u-ownerb', role: 'owner', is_active: true, email: 'owner@b.pk' });
  fake.add('customers', { id: 'cust-a', merchant_id: 'MA', wa_id: '923001112222' });
  orderA = fake.add('orders', { merchant_id: 'MA', customer_id: 'cust-a', order_number: 'SK-1001', status: 'awaiting_payment', payment_method: 'bank_transfer', payment_status: 'claimed', total: 1000, created_at: new Date().toISOString() }).id;
  fake.add('orders', { merchant_id: 'MB', order_number: 'SK-2001', status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending', total: 2000, created_at: new Date().toISOString() });
  productA = fake.add('products', { merchant_id: 'MA', name: 'Kurta', price: 150000, is_active: true, deleted_at: null, images: [] }).id;
  fake.add('products', { merchant_id: 'MB', name: 'Shawl', price: 90000, is_active: true, deleted_at: null, images: [] });
  convoA = fake.add('conversations', { merchant_id: 'MA', customer_id: 'cust-a', status: 'bot_active', current_state: 'greeting', unread_count: 0, context: {} }).id;
  fake.add('conversations', { merchant_id: 'MB', status: 'bot_active', current_state: 'greeting', unread_count: 0, context: {} });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

describe('auth', () => {
  it('no login → 401 UNAUTHORIZED', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });
  it('a bad JWT → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: jwt('jwt.forged.sig') })).statusCode).toBe(401);
  });
  it('a valid JWT with no shop → 401 no_membership', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: jwt('jwt.noshop.sig') });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('no_membership');
  });
  it('a member JWT → their own shop', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: A });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ merchant: { id: 'MA' }, role: 'owner' });
  });
  it('the pilot token as a non-JWT Bearer works too; a wrong token is a plain 401, never no_membership (review P1-3)', async () => {
    let r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { authorization: 'Bearer pilot-admin-token-for-tests' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().isPlatformAdmin).toBe(true);
    r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { 'x-admin-token': 'wrong-token' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });
  it('the pilot admin token → the default shop, as a platform admin', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { 'x-admin-token': 'pilot-admin-token-for-tests' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ merchant: { id: 'MA' }, isPlatformAdmin: true });
  });
});

describe('cross-tenant: merchant B never sees A', () => {
  it("A's order, product and conversation by id are 404 for B (not 403)", async () => {
    for (const url of [`/api/v1/admin/orders/${orderA}`, `/api/v1/admin/products/${productA}`, `/api/v1/admin/conversations/${convoA}`]) {
      expect((await app.inject({ method: 'GET', url, headers: B })).statusCode, url).toBe(404);
      expect((await app.inject({ method: 'GET', url, headers: A })).statusCode, url).toBe(200);
    }
  });
  it("B's lists hold only B's rows", async () => {
    const orders = (await app.inject({ method: 'GET', url: '/api/v1/admin/orders', headers: B })).json().orders;
    expect(orders.map((o: { order_number: string }) => o.order_number)).toEqual(['SK-2001']);
    const products = (await app.inject({ method: 'GET', url: '/api/v1/admin/products', headers: B })).json().products;
    expect(products.map((p: { name: string }) => p.name)).toEqual(['Shawl']);
    const convos = (await app.inject({ method: 'GET', url: '/api/v1/admin/conversations', headers: B })).json().conversations;
    expect(convos).toHaveLength(1);
    expect(convos[0].id).not.toBe(convoA);
  });
  it("B acting on A's order is 404, and the order is untouched", async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderA}/payment/verify`, headers: B });
    expect(r.statusCode).toBe(404);
    expect(fake.rows('orders').find((o) => o.id === orderA)!.payment_status).toBe('claimed');
  });
});

describe('manager-only routes refuse staff (spec 09 §2.3)', () => {
  it.each([
    ['POST', '/api/v1/admin/products', { name: 'X', price: 100 }],
    ['PATCH', '/api/v1/admin/settings', { settings: { upsellEnabled: false } }],
    ['POST', '/api/v1/admin/bank-accounts', { bank_name: 'B', account_title: 'T', account_number: '1' }],
    ['POST', `/api/v1/admin/orders/ORDER/payment/verify`, {}],
  ])('%s %s', async (method, url, payload) => {
    const r = await app.inject({ method: method as 'POST', url: url.replace('ORDER', orderA), headers: STAFF, payload });
    expect(r.statusCode).toBe(403);
  });
  it('staff may read the catalog, without cost', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/products', headers: STAFF });
    expect(r.statusCode).toBe(200);
    expect(r.json().products[0]).not.toHaveProperty('cost');
  });
});

describe('rate limits (FR-P6.3)', () => {
  it('routes fall into the right buckets; the webhook and health routes are exempt', () => {
    expect(bucketFor('/api/v1/signup/check')).toBe('signup');
    expect(bucketFor('/api/v1/admin/login')).toBe('login');
    expect(bucketFor('/api/v1/admin/whatsapp/connect')).toBe('connect');
    expect(bucketFor('/api/v1/admin/orders/:id')).toBe('api');
    expect(exempt('/api/v1/webhook/whatsapp')).toBe(true);
    expect(exempt('/readyz')).toBe(true);
    expect(exempt('/api/v1/admin/me')).toBe(false);
  });
  it('the 11th login attempt in a minute from one IP is 429 in the { error } shape; another IP is unaffected', async () => {
    const from = (ip: string) => app.inject({ method: 'POST', url: '/api/v1/admin/login', headers: { 'x-forwarded-for': ip }, payload: { password: 'nope' } });
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.9')).statusCode).toBe(401);
    const r = await from('203.0.113.9');
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('RATE_LIMITED');
    expect(r.headers['retry-after']).toBeDefined();
    expect((await from('203.0.113.10')).statusCode).toBe(401);
  });
  it('a signed-in caller is counted per shop, not per IP: 300 a minute', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { ...A, 'x-forwarded-for': '198.51.100.1' } });
    expect(r.headers['x-ratelimit-limit']).toBe('300');
  });
});

describe('admin-token lockout is per IP (FR-P6.4)', () => {
  it("ten wrong guesses from one IP lock that IP, and only that IP, for 15 minutes", () => {
    _resetAdminTokenFails();
    for (let i = 0; i < 10; i++) expect(isAdminToken('wrong', '192.0.2.1')).toBe(false);
    expect(isAdminToken('pilot-admin-token-for-tests', '192.0.2.1')).toBe(false); // locked, even with the right token
    expect(isAdminToken('pilot-admin-token-for-tests', '192.0.2.2')).toBe(true); // the owner elsewhere still gets in
    _resetAdminTokenFails();
  });
});
