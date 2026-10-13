// P2 readiness and delivery zones, over FakeDb: the seven checks one by one, the 409 gate on
// `botEnabled: true`, and zone CRUD through the real routes (app.inject) with Supabase mocked.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';
import { computeReadiness, hasBusinessHours } from './readiness';

const fake = new FakeDb();
const M = 'merchant-1';
const USERS: Record<string, { id: string; email: string; user_metadata: Record<string, unknown> }> = {
  'jwt.owner.sig': { id: 'u-owner', email: 'owner@shop.pk', user_metadata: {} },
  'jwt.staff.sig': { id: 'u-staff', email: 'staff@shop.pk', user_metadata: {} },
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
  fake.add('merchants', { id: M, business_name: 'Ali Garments', phone: '923001234567', category: null, business_hours: {}, bot_persona: {}, settings: { botEnabled: false, codEnabled: false }, negotiation_defaults: {} });
  fake.add('merchant_users', { merchant_id: M, auth_user_id: 'u-owner', role: 'owner', is_active: true });
  fake.add('merchant_users', { merchant_id: M, auth_user_id: 'u-staff', role: 'staff', is_active: true });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

const owner = { authorization: 'Bearer jwt.owner.sig' };
const staff = { authorization: 'Bearer jwt.staff.sig' };
const merchant = () => fake.rows('merchants').find((m) => m.id === M)!;

describe('hasBusinessHours', () => {
  it('needs one day with open and close; a closed day does not count', () => {
    expect(hasBusinessHours({})).toBe(false);
    expect(hasBusinessHours({ fri: { closed: true } })).toBe(false);
    expect(hasBusinessHours({ mon: { open: '10:00', close: '22:00' }, fri: { closed: true } })).toBe(true);
    expect(hasBusinessHours(null)).toBe(false);
  });
});

describe('computeReadiness — a bare shop fails every check, each flips on its own data', () => {
  it('starts with all seven failing and a reason for each', async () => {
    const r = await computeReadiness(fake.client, M);
    expect(r.ready).toBe(false);
    expect(r.failing).toEqual(['profile', 'whatsapp', 'catalog', 'delivery', 'payment', 'persona', 'testOrder']);
    for (const s of r.failing) expect(r.steps[s].reason).toBeTruthy();
    expect(r.steps.profile.reason).toContain('a category');
    expect(r.steps.profile.reason).toContain('the two attestations');
    expect(r.steps.whatsapp.reason).toContain('Connect your WhatsApp number');
  });

  it('profile: category, hours and the attestations', async () => {
    Object.assign(merchant(), { category: 'clothing', business_hours: { mon: { open: '10:00', close: '22:00' } } });
    merchant().settings.attestations = { noProhibitedGoods: true, optInOnly: true, at: '2026-10-13T00:00:00Z' };
    expect((await computeReadiness(fake.client, M)).steps.profile).toEqual({ ok: true });
  });

  it('whatsapp: connecting is not connected; needs_attention is a problem; connected passes', async () => {
    const num = fake.add('whatsapp_numbers', { merchant_id: M, phone_number_id: 'PN1', phone_e164: '15550001111', status: 'connecting', waba_id: 'W1' });
    let r = await computeReadiness(fake.client, M);
    expect(r.steps.whatsapp.ok).toBe(false);
    expect(r.steps.whatsapp.reason).toContain('finish connecting');
    num.status = 'needs_attention'; num.attention_message = 'Meta flagged this number';
    r = await computeReadiness(fake.client, M);
    expect(r.steps.whatsapp).toMatchObject({ ok: false, problem: true, reason: 'Meta flagged this number' });
    num.status = 'connected'; num.attention_message = null;
    expect((await computeReadiness(fake.client, M)).steps.whatsapp).toEqual({ ok: true });
  });

  it('catalog: an inactive or unpriced product does not count', async () => {
    fake.add('products', { merchant_id: M, name: 'Hidden', price: 50000, is_active: false });
    fake.add('products', { merchant_id: M, name: 'Free?', price: 0, is_active: true });
    expect((await computeReadiness(fake.client, M)).steps.catalog.ok).toBe(false);
    fake.add('products', { merchant_id: M, name: 'Kurta', price: 250000, is_active: true });
    expect((await computeReadiness(fake.client, M)).steps.catalog.ok).toBe(true);
  });

  it('delivery: a serviceable zone, or the explicit "one charge everywhere" choice', async () => {
    const z = fake.add('delivery_zones', { merchant_id: M, area_name: 'Model Town', charge: 15000, is_serviceable: false });
    expect((await computeReadiness(fake.client, M)).steps.delivery.ok).toBe(false);
    merchant().settings.deliveryConfigured = true;
    expect((await computeReadiness(fake.client, M)).steps.delivery.ok).toBe(true);
    merchant().settings.deliveryConfigured = false;
    z.is_serviceable = true;
    expect((await computeReadiness(fake.client, M)).steps.delivery.ok).toBe(true);
  });

  it('payment: COD on, or an active bank account', async () => {
    expect((await computeReadiness(fake.client, M)).steps.payment.ok).toBe(false);
    const b = fake.add('bank_accounts', { merchant_id: M, bank_name: 'Meezan', account_number: '1', is_active: false });
    expect((await computeReadiness(fake.client, M)).steps.payment.ok).toBe(false);
    b.is_active = true;
    expect((await computeReadiness(fake.client, M)).steps.payment.ok).toBe(true);
    b.is_active = false; merchant().settings.codEnabled = true;
    expect((await computeReadiness(fake.client, M)).steps.payment.ok).toBe(true);
  });

  it('persona: a name alone is not enough', async () => {
    merchant().bot_persona = { name: 'Ali Bhai' };
    expect((await computeReadiness(fake.client, M)).steps.persona.ok).toBe(false);
    merchant().bot_persona = { name: 'Ali Bhai', style: 'standard' };
    expect((await computeReadiness(fake.client, M)).steps.persona.ok).toBe(true);
  });

  it('testOrder: only a placed order from the owner\'s own phone, matched as digits', async () => {
    const stranger = fake.add('customers', { merchant_id: M, wa_id: '923009999999' });
    const me = fake.add('customers', { merchant_id: M, wa_id: '923001234567' });
    fake.add('orders', { merchant_id: M, customer_id: stranger.id, status: 'confirmed' });
    fake.add('orders', { merchant_id: M, customer_id: me.id, status: 'draft' });
    expect((await computeReadiness(fake.client, M)).steps.testOrder.ok).toBe(false);
    merchant().phone = '+92 300 1234567'; // a phone typed with spaces still matches the wa_id
    fake.add('orders', { merchant_id: M, customer_id: me.id, status: 'awaiting_payment' });
    const r = await computeReadiness(fake.client, M);
    expect(r.steps.testOrder.ok).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.failing).toEqual([]);
  });
});

describe('GET /api/v1/admin/readiness and the go-live gate', () => {
  it('serves the readiness block to a signed-in merchant', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/readiness', headers: owner });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ready: true, failing: [] });
    expect(Object.keys(r.json().steps)).toHaveLength(7);
  });

  it('PATCH settings botEnabled:true is 409 not_ready while a check fails, and the bot stays off', async () => {
    merchant().bot_persona = {}; // break one check
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/settings', headers: owner, payload: { settings: { botEnabled: true, onboardingCompletedAt: '2026-10-13T00:00:00Z' } } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'not_ready', failing: ['persona'] });
    expect(merchant().settings.botEnabled).toBe(false);
    expect(merchant().settings.onboardingCompletedAt).toBeUndefined();
  });

  it('…and 200 once every check passes', async () => {
    merchant().bot_persona = { name: 'Ali Bhai', style: 'standard' };
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/settings', headers: owner, payload: { settings: { botEnabled: true } } });
    expect(r.statusCode).toBe(200);
    expect(merchant().settings.botEnabled).toBe(true);
  });

  it('switching the bot off never needs readiness', async () => {
    merchant().bot_persona = {};
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/settings', headers: owner, payload: { settings: { botEnabled: false } } });
    expect(r.statusCode).toBe(200);
    merchant().bot_persona = { name: 'Ali Bhai', style: 'standard' };
  });

  it('GET settings carries the readiness block (FR-P2.6)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/settings', headers: owner });
    expect(r.statusCode).toBe(200);
    expect(r.json().readiness).toMatchObject({ ready: true });
  });
});

describe('delivery zones CRUD', () => {
  let id: string;

  it('staff cannot write zones', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/delivery-zones', headers: staff, payload: { area_name: 'Gulberg', charge: 20000 } });
    expect(r.statusCode).toBe(403);
  });

  it('rejects a bad charge and a one-letter area', async () => {
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/delivery-zones', headers: owner, payload: { area_name: 'Gulberg', charge: -5 } });
    expect(r.statusCode).toBe(400);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/delivery-zones', headers: owner, payload: { area_name: 'G', charge: 20000 } });
    expect(r.statusCode).toBe(400);
  });

  it('creates a zone, serviceable by default, with trimmed text', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/delivery-zones', headers: owner, payload: { area_name: '  Gulberg ', city: 'Lahore', charge: 20000, eta_text: '' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().zone).toMatchObject({ area_name: 'Gulberg', city: 'Lahore', charge: 20000, is_serviceable: true, eta_text: null });
    id = r.json().zone.id;
  });

  it('refuses the same area in a different case (409)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/delivery-zones', headers: owner, payload: { area_name: 'GULBERG', charge: 10000 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('DUPLICATE');
  });

  it('edits a zone, but not into another zone\'s name', async () => {
    let r = await app.inject({ method: 'PATCH', url: `/api/v1/admin/delivery-zones/${id}`, headers: owner, payload: { charge: 25000, is_serviceable: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json().zone).toMatchObject({ charge: 25000, is_serviceable: false });
    r = await app.inject({ method: 'PATCH', url: `/api/v1/admin/delivery-zones/${id}`, headers: owner, payload: { area_name: 'model town' } });
    expect(r.statusCode).toBe(409);
  });

  it('lists zones for the merchant, alphabetically', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/delivery-zones', headers: owner });
    expect(r.statusCode).toBe(200);
    expect(r.json().zones.map((z: { area_name: string }) => z.area_name)).toEqual(['Gulberg', 'Model Town']);
  });

  it('deletes a zone and answers 404 for one that is not yours or gone', async () => {
    let r = await app.inject({ method: 'DELETE', url: `/api/v1/admin/delivery-zones/${id}`, headers: owner });
    expect(r.statusCode).toBe(200);
    r = await app.inject({ method: 'DELETE', url: `/api/v1/admin/delivery-zones/${id}`, headers: owner });
    expect(r.statusCode).toBe(404);
    expect(fake.rows('delivery_zones')).toHaveLength(1);
  });
});

describe('PATCH /api/v1/admin/profile and the logo (P2 step 1)', () => {
  it('refuses a category off the list and malformed hours', async () => {
    let r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/profile', headers: owner, payload: { category: 'toys' } });
    expect(r.statusCode).toBe(400);
    r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/profile', headers: owner, payload: { businessHours: { monday: { open: '10:00', close: '22:00' } } } });
    expect(r.statusCode).toBe(400);
    r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/profile', headers: owner, payload: { phone: '+1 555 0100' } });
    expect(r.statusCode).toBe(400);
  });

  it('writes the fields sent, stores the phone as digits, and answers with readiness', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/profile', headers: owner, payload: { ownerName: ' Ali Raza ', phone: '0300-1234567', address: 'Shop 4, Liberty Market', category: 'clothing', businessHours: { mon: { open: '09:00', close: '21:00' }, fri: { closed: true } } } });
    expect(r.statusCode).toBe(200);
    expect(merchant()).toMatchObject({ owner_name: 'Ali Raza', phone: '923001234567', address: 'Shop 4, Liberty Market', category: 'clothing' });
    expect(merchant().business_hours).toEqual({ mon: { open: '09:00', close: '21:00' }, fri: { closed: true } });
    expect(r.json().readiness.steps.profile.ok).toBe(true);
  });

  it('staff may not edit the profile', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/profile', headers: staff, payload: { ownerName: 'X' } });
    expect(r.statusCode).toBe(403);
  });

  it('uploads a logo and records its public URL', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/settings/logo', headers: owner, payload: { dataBase64: Buffer.from('png').toString('base64'), contentType: 'image/png' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().logoUrl).toContain(`merchants/${M}/logo-`);
    expect(merchant().logo_url).toBe(r.json().logoUrl);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/admin/settings/logo', headers: owner, payload: { dataBase64: 'x', contentType: 'text/plain' } });
    expect(bad.statusCode).toBe(400);
  });
});
