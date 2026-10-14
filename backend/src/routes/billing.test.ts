// P7 routes through the real server: the merchant's billing page and the console's invoice actions.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

const fake = new FakeDb();
const USERS: Record<string, { id: string; email: string; user_metadata: Record<string, unknown> }> = {
  'jwt.owner.sig': { id: 'u-owner', email: 'owner@shop.pk', user_metadata: {} },
  'jwt.staff.sig': { id: 'u-staff', email: 'staff@shop.pk', user_metadata: {} },
  'jwt.fazal.sig': { id: 'u-fazal', email: 'fazal@sahulatcart.com', user_metadata: {} },
};
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.client,
  getAnonClient: () => ({ auth: { getUser: async (token: string) => (USERS[token] ? { data: { user: USERS[token] }, error: null } : { data: { user: null }, error: { message: 'bad' } }) } }),
}));

let app: FastifyInstance;
const owner = { authorization: 'Bearer jwt.owner.sig' };
const staff = { authorization: 'Bearer jwt.staff.sig' };
const fazal = { authorization: 'Bearer jwt.fazal.sig' };
let invoiceId: string;
beforeAll(async () => {
  fake.add('merchants', { id: 'M', business_name: 'Ali Store', status: 'active', plan: 'pilot', settings: { botEnabled: true }, negotiation_defaults: {}, bot_persona: {} });
  fake.add('merchant_users', { id: 'mu-o', merchant_id: 'M', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'owner@shop.pk' });
  fake.add('merchant_users', { id: 'mu-s', merchant_id: 'M', auth_user_id: 'u-staff', role: 'staff', is_active: true, email: 'staff@shop.pk' });
  fake.add('platform_admins', { auth_user_id: 'u-fazal', email: 'fazal@sahulatcart.com', is_active: true });
  const s = fake.add('subscriptions', { merchant_id: 'M', plan: 'pilot', status: 'past_due', trial_ends_at: '2026-10-01T00:00:00.000Z', current_period_start: null, current_period_end: null, requested_plan: null });
  invoiceId = fake.add('invoices', { merchant_id: 'M', subscription_id: s.id, plan: 'basic', period_start: '2026-10-01T00:00:00.000Z', period_end: '2026-11-01T00:00:00.000Z', amount_paisa: 299900, status: 'due', reference: null }).id;
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

describe('GET /api/v1/admin/billing', () => {
  it('shows the plan, the mode and why, usage against the limit, the invoices and the bank details', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/billing', headers: staff });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ plan: 'pilot', mode: 'handoff', reason: 'past_due', limits: { conversations: 300 }, subscription: { status: 'past_due' } });
    expect(b.usage).toMatchObject({ conversations: 0, outbound: 0 });
    expect(b.invoices).toHaveLength(1);
    expect(b.invoices[0]).toMatchObject({ id: invoiceId, status: 'due', amount_paisa: 299900 });
    expect(b.plans.map((p: { id: string; pricePaisa: number }) => [p.id, p.pricePaisa])).toEqual([['pilot', 0], ['basic', 299900], ['pro', 799900]]);
    expect(typeof b.bankDetails).toBe('string');
  });
});

describe('claim and plan request (manager only)', () => {
  it('staff get 403', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/invoices/${invoiceId}/claim`, headers: staff, payload: { reference: 'TRX1' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/request', headers: staff, payload: { plan: 'pro' } })).statusCode).toBe(403);
  });
  it('a claim records the reference and leaves the invoice due', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/invoices/${invoiceId}/claim`, headers: owner, payload: { reference: '' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/invoices/${invoiceId}/claim`, headers: owner, payload: { reference: ' TRX-778899 ' } });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('invoices')[0]).toMatchObject({ status: 'due', reference: 'TRX-778899' });
    expect(fake.rows('platform_notifications').at(-1)).toMatchObject({ kind: 'invoice_claimed', merchant_id: 'M', title: 'Ali Store: Invoice claimed', data: { invoiceId } }); // U2
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/invoices/nope/claim', headers: owner, payload: { reference: 'x' } })).statusCode).toBe(404);
  });
  it('a plan request is recorded for the console; pilot cannot be requested', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/request', headers: owner, payload: { plan: 'pilot' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/request', headers: owner, payload: { plan: 'pro' } });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('subscriptions')[0]!.requested_plan).toBe('pro');
    expect(fake.rows('platform_notifications').at(-1)).toMatchObject({ kind: 'plan_requested', merchant_id: 'M', body: 'pilot → pro', data: { plan: 'pro' } }); // U2
  });
});

describe('the platform console (FR-P7.5)', () => {
  it('merchants cannot open it', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/invoices', headers: owner })).statusCode).toBe(403);
  });
  it('lists due invoices with their claimed reference and the plan requests', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/invoices', headers: fazal });
    expect(r.statusCode).toBe(200);
    expect(r.json().invoices[0]).toMatchObject({ id: invoiceId, businessName: 'Ali Store', reference: 'TRX-778899', status: 'due' });
    expect(r.json().requests[0]).toMatchObject({ merchant_id: 'M', requested_plan: 'pro', businessName: 'Ali Store' });
  });
  it('a plan change applies and clears the request', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M/plan', headers: fazal, payload: { plan: 'gold' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/v1/platform/merchants/M/plan', headers: fazal, payload: { plan: 'pro' } });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('subscriptions')[0]).toMatchObject({ plan: 'pro', requested_plan: null });
    expect(fake.rows('merchants')[0]!.plan).toBe('pro');
  });
  it('mark paid restores selling within one request; twice is 409', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/platform/invoices/${invoiceId}/paid`, headers: fazal });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('subscriptions')[0]).toMatchObject({ status: 'active', current_period_end: '2026-11-01T00:00:00.000Z' });
    const b = (await app.inject({ method: 'GET', url: '/api/v1/admin/billing', headers: owner })).json();
    expect(b).toMatchObject({ mode: 'sell', reason: null, subscription: { status: 'active' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/platform/invoices/${invoiceId}/paid`, headers: fazal })).statusCode).toBe(409);
  });
});
