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
const USERS: Record<string, { id: string; email: string; email_confirmed_at: string | null; user_metadata: Record<string, unknown> }> = {
  'jwt.fazal.sig': { id: 'user-fazal', email: 'fazal@sahulatcart.com', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  // F2: invited by email, no auth user bound yet
  'jwt.invited.sig': { id: 'user-invited', email: 'Invited@Sahulatcart.com', email_confirmed_at: '2026-10-14T10:00:00Z', user_metadata: {} },
  'jwt.unconfirmed.sig': { id: 'user-unconfirmed', email: 'pending@sahulatcart.com', email_confirmed_at: null, user_metadata: {} },
  'jwt.owner.sig': { id: 'user-owner', email: 'owner@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.staff.sig': { id: 'user-staff', email: 'staff@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.adminowner.sig': { id: 'user-adminowner', email: 'both@sahulatcart.com', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
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
  db.add('platform_admins', { id: 'PA-invited', auth_user_id: null, email: 'invited@sahulatcart.com', is_active: true });
  db.add('platform_admins', { id: 'PA-pending', auth_user_id: null, email: 'pending@sahulatcart.com', is_active: true });
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

  it("each row says whether the bot sells and why, and carries the shop's invoice and plan request (console triage)", async () => {
    fake.db.add('subscriptions', { merchant_id: 'M1', plan: 'basic', status: 'active', current_period_end: '2026-11-01T00:00:00Z', requested_plan: 'pro' });
    fake.db.add('invoices', { id: 'INV2', merchant_id: 'M2', plan: 'basic', period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z', amount_paisa: 299900, status: 'due', reference: 'IBFT 77', claimed_at: '2026-10-14T05:00:00Z' });
    fake.db.add('invoices', { id: 'INV-OLD', merchant_id: 'M2', plan: 'basic', period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z', amount_paisa: 299900, status: 'paid' });
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants', headers: jwt('jwt.fazal.sig') });
    const list = r.json().merchants as { id: string; selling: { selling: boolean; code: string; reason: string | null }; subscription: unknown; dueInvoice: unknown }[];
    const m1 = list.find((m) => m.id === 'M1')!;
    const m2 = list.find((m) => m.id === 'M2')!;
    expect(m1.selling).toEqual({ selling: true, code: 'selling', reason: null });
    expect(m1.subscription).toMatchObject({ status: 'active', plan: 'basic', requestedPlan: 'pro' });
    expect(m1.dueInvoice).toBeNull();
    expect(m2.selling).toMatchObject({ selling: false, code: 'no_whatsapp' });
    expect(m2.dueInvoice).toEqual({ id: 'INV2', plan: 'basic', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', amountPaisa: 299900, reference: 'IBFT 77', claimedAt: '2026-10-14T05:00:00Z' });
    expect((r.json().plans as { id: string; pricePaisa: number }[]).map((p) => p.id)).toEqual(['pilot', 'basic', 'pro']);
    // A revoked token is "not selling", even though billing alone would say sell.
    fake.db.rows('whatsapp_numbers').find((n) => n.merchant_id === 'M1')!.status = 'needs_attention';
    fake.db.rows('whatsapp_numbers').find((n) => n.merchant_id === 'M1')!.flag_reason = 'token';
    const r2 = await app.inject({ method: 'GET', url: '/api/v1/platform/merchants', headers: jwt('jwt.fazal.sig') });
    expect((r2.json().merchants as { id: string; selling: { code: string } }[]).find((m) => m.id === 'M1')!.selling.code).toBe('token');
  });

  it('the invoices route carries the plan prices the inbox needs to apply a request in place', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/invoices', headers: jwt('jwt.fazal.sig') });
    expect((r.json().plans as { id: string }[]).map((p) => p.id)).toEqual(['pilot', 'basic', 'pro']);
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

describe('invited admins (F2): bound at the first confirmed login', () => {
  it("a confirmed JWT whose email matches an unbound row reaches the console and binds the row", async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/platform/me', headers: jwt('jwt.invited.sig') });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ isPlatformAdmin: true, email: 'invited@sahulatcart.com', merchantId: null });
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA-invited')!.auth_user_id).toBe('user-invited');
    // and the second call finds it by auth_user_id as usual
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/merchants', headers: jwt('jwt.invited.sig') })).statusCode).toBe(200);
  });

  it('an unconfirmed email does not bind and is refused', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/platform/me', headers: jwt('jwt.unconfirmed.sig') });
    expect(me.statusCode).toBe(403);
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA-pending')!.auth_user_id).toBeNull();
  });

  it('an inactive invited row is never bound', async () => {
    fake.db.rows('platform_admins').find((a) => a.id === 'PA-invited')!.is_active = false;
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/me', headers: jwt('jwt.invited.sig') })).statusCode).toBe(403);
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA-invited')!.auth_user_id).toBeNull();
  });

  it('bootstrap for an invited admin answers 409 PLATFORM_ADMIN and creates no shop', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: jwt('jwt.invited.sig'), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('PLATFORM_ADMIN');
    expect(fake.db.rows('merchants')).toHaveLength(2);
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA-invited')!.auth_user_id).toBe('user-invited');
  });
});
