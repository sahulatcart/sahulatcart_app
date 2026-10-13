// M6: the platform console and suspension, through the real HTTP routes (app.inject) over FakeDb.
// Supabase auth is mocked with a table of known test tokens; the pilot admin token is set too.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

vi.hoisted(() => {
  process.env.ADMIN_API_TOKEN = 'pilot-admin-token-for-tests';
  process.env.SIGNUP_OPEN = 'true';
});

const fake = { db: new FakeDb() };
const USERS: Record<string, { id: string; email: string; user_metadata: Record<string, unknown> }> = {
  'jwt.fazal.sig': { id: 'user-fazal', email: 'fazal@sahulatcart.com', user_metadata: {} },
  'jwt.owner.sig': { id: 'user-owner', email: 'owner@shop.pk', user_metadata: {} },
  'jwt.staff.sig': { id: 'user-staff', email: 'staff@shop.pk', user_metadata: {} },
  'jwt.adminowner.sig': { id: 'user-adminowner', email: 'both@sahulatcart.com', user_metadata: {} },
};
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.db.client,
  getAnonClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const u = USERS[token];
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
  }),
}));

let app: FastifyInstance;
beforeAll(async () => {
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

const jwt = (t: string) => ({ authorization: `Bearer ${t}` });
const adminToken = { 'x-admin-token': 'pilot-admin-token-for-tests' };

function seed() {
  const db = fake.db;
  db.reset();
  db.add('merchants', { id: 'M1', business_name: 'Ali Store', email: 'owner@shop.pk', phone: '923001111111', status: 'active', plan: 'pilot', settings: { botEnabled: true }, bot_persona: {}, negotiation_defaults: {} });
  db.add('merchants', { id: 'M2', business_name: 'Bilal Mobiles', email: 'bilal@shop.pk', phone: '923002222222', status: 'active', plan: 'pilot', settings: { botEnabled: true }, bot_persona: {}, negotiation_defaults: {} });
  db.add('merchant_users', { id: 'MU1', merchant_id: 'M1', auth_user_id: 'user-owner', email: 'owner@shop.pk', role: 'owner', is_active: true });
  db.add('merchant_users', { id: 'MU2', merchant_id: 'M1', auth_user_id: 'user-staff', email: 'staff@shop.pk', role: 'staff', is_active: true });
  db.add('merchant_users', { id: 'MU3', merchant_id: 'M2', auth_user_id: 'user-adminowner', email: 'both@sahulatcart.com', role: 'owner', is_active: true });
  db.add('platform_admins', { auth_user_id: 'user-fazal', email: 'fazal@sahulatcart.com', is_active: true });
  db.add('platform_admins', { auth_user_id: 'user-adminowner', email: 'both@sahulatcart.com', is_active: true });
  db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: 'PN1', phone_e164: '923001111111', status: 'connected', quality_rating: 'green', flag_reason: null });
  db.add('orders', { merchant_id: 'M1', order_number: 'SK-1001', status: 'confirmed', total: 1000, created_at: new Date().toISOString() }); // the fake clock starts in September
  return db;
}
beforeEach(seed);

describe('who may open the console', () => {
  it('a platform admin without any shop: console yes, merchant routes 403 NO_SHOP (never no_membership)', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/platform/me', headers: jwt('jwt.fazal.sig') });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ isPlatformAdmin: true, email: 'fazal@sahulatcart.com', merchantId: null });
    const shop = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: jwt('jwt.fazal.sig') });
    expect(shop.statusCode).toBe(403);
    expect(shop.json().error.code).toBe('NO_SHOP');
  });

  it('a platform admin who also owns a shop gets both', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/platform/me', headers: jwt('jwt.adminowner.sig') });
    expect(me.json()).toMatchObject({ isPlatformAdmin: true, merchantId: 'M2' });
    const shop = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: jwt('jwt.adminowner.sig') });
    expect(shop.statusCode).toBe(200);
    expect(shop.json().isPlatformAdmin).toBe(true);
  });

  it('an ordinary owner, staff, and an anonymous caller are refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants', headers: jwt('jwt.owner.sig') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants', headers: jwt('jwt.staff.sig') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants' })).statusCode).toBe(401);
  });

  it('the pilot admin token still reaches the console', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/me', headers: adminToken });
    expect(r.statusCode).toBe(200);
    expect(r.json().via).toBe('token');
  });

  it('a platform admin cannot bootstrap a shop for themselves by accident', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: jwt('jwt.fazal.sig'), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('PLATFORM_ADMIN');
    expect(fake.db.rows('merchants')).toHaveLength(2);
  });
});

describe('the merchant list', () => {
  it('shows every shop with its connection, owner, orders and usage, and searches', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants', headers: jwt('jwt.fazal.sig') });
    expect(r.statusCode).toBe(200);
    const list = r.json().merchants as { id: string; ownerEmail: string; connection: { status: string }; ordersThisMonth: number }[];
    expect(list.map((m) => m.id).sort()).toEqual(['M1', 'M2']);
    const m1 = list.find((m) => m.id === 'M1')!;
    expect(m1).toMatchObject({ ownerEmail: 'owner@shop.pk', connection: { status: 'connected', phone: '923001111111' }, ordersThisMonth: 1, status: 'active' });
    expect(list.find((m) => m.id === 'M2')!.connection).toEqual({ status: 'none' });
    const s = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants?q=bilal', headers: jwt('jwt.fazal.sig') });
    expect((s.json().merchants as { id: string }[]).map((m) => m.id)).toEqual(['M2']);
  });
});

describe('suspension', () => {
  it('suspend needs a reason, records it, and the shop is told; unsuspend reverses it', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M1/suspend', headers: jwt('jwt.fazal.sig'), payload: {} })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M1/suspend', headers: jwt('jwt.fazal.sig'), payload: { reason: 'selling prohibited goods' } });
    expect(r.statusCode).toBe(200);
    const m = fake.db.rows('merchants').find((x) => x.id === 'M1')!;
    expect(m.status).toBe('suspended');
    expect(m.settings.suspension).toMatchObject({ reason: 'selling prohibited goods', by: 'fazal@sahulatcart.com' });
    expect(fake.db.rows('audit_log').at(-1)).toMatchObject({ action: 'suspend', entity: 'merchant', entity_id: 'M1', user_id: 'user-fazal' });
    expect(fake.db.rows('notifications').at(-1)).toMatchObject({ merchant_id: 'M1', type: 'system' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M1/suspend', headers: jwt('jwt.fazal.sig'), payload: { reason: 'again' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/NOPE/suspend', headers: jwt('jwt.fazal.sig'), payload: { reason: 'x' } })).statusCode).toBe(404);
    const u = await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M1/unsuspend', headers: jwt('jwt.fazal.sig') });
    expect(u.statusCode).toBe(200);
    expect(fake.db.rows('merchants').find((x) => x.id === 'M1')!.status).toBe('active');
    expect(fake.db.rows('merchants').find((x) => x.id === 'M1')!.settings.suspension).toBeUndefined();
  });

  it("a suspended shop's owner can still read /me and settings but nothing else", async () => {
    await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M1/suspend', headers: jwt('jwt.fazal.sig'), payload: { reason: 'unpaid' } });
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: jwt('jwt.owner.sig') });
    expect(me.statusCode).toBe(200);
    expect(me.json().merchant.status).toBe('suspended');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/settings', headers: jwt('jwt.owner.sig') })).statusCode).toBe(200);
    const orders = await app.inject({ method: 'GET', url: '/api/v1/admin/orders', headers: jwt('jwt.owner.sig') });
    expect(orders.statusCode).toBe(403);
    expect(orders.json().error.code).toBe('merchant_suspended');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/whatsapp', headers: jwt('jwt.owner.sig') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/settings', headers: jwt('jwt.owner.sig'), payload: { settings: { botEnabled: false } } })).statusCode).toBe(403);
  });
});
