// P1 signup and the auth gate, through the real HTTP routes (app.inject) over FakeDb.
// Supabase is mocked: the DB is the in-memory fake, and auth.getUser() answers from a table
// of known test tokens. No network, no real project.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';
import { _resetSignupGateCache, signupAllowed, signupProfile } from './signup';

// Before any import of config: the allow-list that the "closed" and "open" cases test against.
vi.hoisted(() => {
  process.env.SIGNUP_OPEN = 'false';
  process.env.SIGNUP_ALLOWLIST = 'Ali@Shop.pk, second@shop.pk';
});

const fake = new FakeDb();
const USERS: Record<string, { id: string; email: string; email_confirmed_at?: string | null; user_metadata: Record<string, unknown> }> = {
  'jwt.ali.sig': {
    id: 'user-ali',
    email: 'ali@shop.pk',
    email_confirmed_at: '2026-10-13T10:00:00Z',
    user_metadata: { shopName: 'Ali Garments', ownerName: 'Ali Raza', phone: '+92 300 1234567', attestations: { noProhibitedGoods: true, optInOnly: true } },
  },
  'jwt.stranger.sig': { id: 'user-stranger', email: 'stranger@example.com', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: { shopName: 'X Store', ownerName: 'Xy', phone: '03001112223' } },
  'jwt.unconfirmed.sig': { id: 'user-unconfirmed', email: 'second@shop.pk', email_confirmed_at: null, user_metadata: { shopName: 'Second Store', ownerName: 'Sana Khan', phone: '03009998877' } },
  'jwt.second.sig': { id: 'user-second', email: 'second@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: { shopName: 'Second Store', ownerName: 'Sana Khan', phone: '03009998877' } },
};

vi.mock('./supabase', () => ({
  getServiceClient: () => fake.client,
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('signupAllowed (the SIGNUP_OPEN / SIGNUP_ALLOWLIST gate)', () => {
  it('is case-insensitive and ignores spaces in the list', () => {
    const cfg = { SIGNUP_OPEN: false, SIGNUP_ALLOWLIST: ' Ali@Shop.pk ,second@shop.pk' };
    expect(signupAllowed('ALI@shop.pk', cfg)).toBe(true);
    expect(signupAllowed('second@shop.pk', cfg)).toBe(true);
    expect(signupAllowed('third@shop.pk', cfg)).toBe(false);
    expect(signupAllowed('', cfg)).toBe(false);
  });
  it('lets everyone in once SIGNUP_OPEN is true', () => {
    expect(signupAllowed('anyone@example.com', { SIGNUP_OPEN: true, SIGNUP_ALLOWLIST: '' })).toBe(true);
  });
});

describe('signupProfile (what the form stored in the auth user)', () => {
  it('normalises the phone to digits and stamps the attestations', () => {
    const p = signupProfile(USERS['jwt.ali.sig']!.user_metadata);
    expect(p).toMatchObject({ shopName: 'Ali Garments', ownerName: 'Ali Raza', phone: '923001234567' });
    expect('attestations' in p && p.attestations).toMatchObject({ noProhibitedGoods: true, optInOnly: true });
  });
  it('refuses a short name, a control character, or a non-Pakistani phone', () => {
    expect(signupProfile({ shopName: 'A', ownerName: 'Ali', phone: '+923001234567' })).toHaveProperty('error');
    expect(signupProfile({ shopName: 'Ali\u0007Store', ownerName: 'Ali', phone: '+923001234567' })).toHaveProperty('error');
    expect(signupProfile({ shopName: 'Ali Store', ownerName: 'Ali', phone: '+1 300 1234567' })).toHaveProperty('error');
  });
  it('leaves attestations null unless both boxes were ticked', () => {
    const p = signupProfile({ shopName: 'Ali Store', ownerName: 'Ali', phone: '+923001234567', attestations: { noProhibitedGoods: true } });
    expect('attestations' in p && p.attestations).toBeNull();
  });
});

describe('POST /api/v1/signup/check', () => {
  it('answers from the allow-list without touching auth', async () => {
    const yes = await app.inject({ method: 'POST', url: '/api/v1/signup/check', payload: { email: 'ali@shop.pk' } });
    const no = await app.inject({ method: 'POST', url: '/api/v1/signup/check', payload: { email: 'stranger@example.com' } });
    expect(yes.json()).toEqual({ allowed: true });
    expect(no.json()).toEqual({ allowed: false });
  });
});

describe('the gate follows platform_settings (U3)', () => {
  it('a stored signup_open row opens /signup/check and /api/v1/config; removing it (and the cache) closes them again', async () => {
    _resetSignupGateCache();
    const ip = { 'x-forwarded-for': '203.0.113.77' }; // its own signup rate-limit bucket: this file already makes most of one IP's ten a minute
    const row = fake.add('platform_settings', { key: 'signup_open', value: true });
    expect((await app.inject({ method: 'POST', url: '/api/v1/signup/check', headers: ip, payload: { email: 'stranger@example.com' } })).json()).toEqual({ allowed: true });
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().signupOpen).toBe(true);
    fake.rows('platform_settings').splice(fake.rows('platform_settings').indexOf(row), 1);
    _resetSignupGateCache();
    expect((await app.inject({ method: 'POST', url: '/api/v1/signup/check', headers: ip, payload: { email: 'stranger@example.com' } })).json()).toEqual({ allowed: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().signupOpen).toBe(false);
  });
});

describe('GET /api/v1/config', () => {
  it('exposes signupOpen but never the allow-list', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(r.json()).toMatchObject({ signupOpen: false });
    expect(JSON.stringify(r.json())).not.toContain('shop.pk');
  });
});

describe('the auth gate (requireMerchant)', () => {
  it('a valid JWT with no shop gets 401 no_membership, not a plain 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: auth('jwt.ali.sig') });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('no_membership');
  });
  it('a bad token is a plain 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: auth('jwt.bad.sig') });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/v1/signup/bootstrap', () => {
  it('needs a login', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap' });
    expect(r.statusCode).toBe(401);
  });

  it('refuses an email that is not on the allow-list while signup is closed (403 signup_closed), creating nothing', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: auth('jwt.stranger.sig') });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('signup_closed');
    expect(fake.rows('merchants')).toHaveLength(0);
  });

  it('an unconfirmed email is 401 even on the allow-list (review P1-1)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: auth('jwt.unconfirmed.sig') });
    expect(r.statusCode).toBe(401);
    expect(fake.rows('merchants')).toHaveLength(0);
  });

  it('{"email":5} on /signup/check is a plain "not allowed", not a crash (review P1-7)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/check', payload: { email: 5 } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ allowed: false });
  });

  it('creates one shop and one owner row for an allow-listed user, with the bot off', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: auth('jwt.ali.sig') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ role: 'owner', existing: false });
    const m = fake.rows('merchants');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ business_name: 'Ali Garments', owner_name: 'Ali Raza', email: 'ali@shop.pk', phone: '923001234567', status: 'active' });
    expect(m[0]!.settings).toMatchObject({ botEnabled: false, onboardingCompletedAt: null });
    expect(m[0]!.settings.attestations).toMatchObject({ noProhibitedGoods: true, optInOnly: true });
    expect(fake.rows('merchant_users')).toHaveLength(1);
    expect(fake.rows('merchant_users')[0]).toMatchObject({ auth_user_id: 'user-ali', role: 'owner', merchant_id: m[0]!.id });
    // P7: 30 free days start at bootstrap.
    expect(fake.rows('subscriptions')).toHaveLength(1);
    expect(fake.rows('subscriptions')[0]).toMatchObject({ merchant_id: m[0]!.id, plan: 'pilot', status: 'trial' });
    expect(new Date(fake.rows('subscriptions')[0]!.trial_ends_at).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });

  it('the two conflicts are 409 with plain copy: a deactivated membership, an email another shop uses (review P1-5)', async () => {
    const me = fake.rows('merchant_users').find((u) => u.auth_user_id === 'user-ali')!;
    me.is_active = false;
    let r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: auth('jwt.ali.sig') });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('inactive_membership');
    expect(r.json().error.message).not.toMatch(/violat|constraint|duplicate/i);
    me.is_active = true;
    fake.add('merchants', { business_name: 'Taken', email: 'second@shop.pk', settings: {} });
    r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: auth('jwt.second.sig') });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('email_in_use');
    expect(fake.rows('merchant_users').filter((u) => u.auth_user_id === 'user-second')).toHaveLength(0);
    fake.rows('merchants').pop();
  });

  it('a second bootstrap returns the same shop and creates nothing (idempotent)', async () => {
    const first = fake.rows('merchants')[0]!.id;
    const r = await app.inject({ method: 'POST', url: '/api/v1/signup/bootstrap', headers: auth('jwt.ali.sig') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ merchantId: first, existing: true }); // review P1-10: the page sends them to the dashboard
    expect(fake.rows('merchants')).toHaveLength(1);
    expect(fake.rows('merchant_users')).toHaveLength(1);
  });

  it('after bootstrap the same JWT passes the auth gate', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: auth('jwt.ali.sig') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ role: 'owner', isPlatformAdmin: false });
    expect(r.json().merchant.business_name).toBe('Ali Garments');
  });
});
