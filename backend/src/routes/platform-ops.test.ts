// F1/F2: the audit-log reader, the job heartbeats and the platform admins, through the real HTTP
// routes (app.inject) over FakeDb. Same boot and user table as platform.test.ts.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

vi.hoisted(() => {
  process.env.ADMIN_API_TOKEN = 'pilot-admin-token-for-tests';
});

const fake = { db: new FakeDb() };
const USERS: Record<string, { id: string; email: string; email_confirmed_at: string | null; user_metadata: Record<string, unknown> }> = {
  'jwt.fazal.sig': { id: 'user-fazal', email: 'fazal@sahulatcart.com', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.uzair.sig': { id: 'user-uzair', email: 'uzair@sahulatcart.com', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.owner.sig': { id: 'user-owner', email: 'owner@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
  'jwt.staff.sig': { id: 'user-staff', email: 'staff@shop.pk', email_confirmed_at: '2026-10-13T10:00:00Z', user_metadata: {} },
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
const fazal = jwt('jwt.fazal.sig');

function seed() {
  const db = fake.db;
  db.reset();
  db.add('merchants', { id: 'M1', business_name: 'Ali Store', email: 'owner@shop.pk', status: 'active', plan: 'pilot', settings: {} });
  db.add('merchants', { id: 'M2', business_name: 'Bilal Mobiles', email: 'bilal@shop.pk', status: 'active', plan: 'pilot', settings: {} });
  db.add('merchant_users', { id: 'MU1', merchant_id: 'M1', auth_user_id: 'user-owner', email: 'owner@shop.pk', role: 'owner', is_active: true });
  db.add('merchant_users', { id: 'MU2', merchant_id: 'M1', auth_user_id: 'user-staff', email: 'staff@shop.pk', role: 'staff', is_active: true });
  db.add('platform_admins', { id: 'PA1', auth_user_id: 'user-fazal', email: 'fazal@sahulatcart.com', name: 'Fazal', is_active: true });
  db.add('platform_admins', { id: 'PA2', auth_user_id: 'user-uzair', email: 'uzair@sahulatcart.com', name: 'Uzair', is_active: true });
  // audit rows: three for M1, one for M2, one platform-level, in this order (the fake clock ticks per add)
  db.add('audit_log', { id: 'A1', merchant_id: 'M1', actor: 'merchant', user_id: 'MU1', action: 'product_created', entity: 'product', entity_id: 'P1', diff: { name: 'Mug' } });
  db.add('audit_log', { id: 'A2', merchant_id: 'M2', actor: 'platform', user_id: 'user-fazal', action: 'suspend', entity: 'merchant', entity_id: 'M2', diff: { reason: 'x' } });
  db.add('audit_log', { id: 'A3', merchant_id: 'M1', actor: 'platform', user_id: 'user-fazal', action: 'plan_changed', entity: 'subscription', entity_id: 'S1', diff: { plan: 'basic' } });
  db.add('audit_log', { id: 'A4', merchant_id: null, actor: 'system', user_id: null, action: 'purge_logs', entity: 'retention', entity_id: null, diff: { webhook_events: 3 } });
  db.add('audit_log', { id: 'A5', merchant_id: 'M1', actor: 'merchant', user_id: 'MU1', action: 'product_created', entity: 'product', entity_id: 'P2', diff: { name: 'Cap' } });
  db.add('job_runs', { job: 'billing', interval_seconds: 21600, started_at: '2026-10-14T06:00:00Z', finished_at: '2026-10-14T06:00:01Z', ok: true, error: null, summary: { warned: 0 } });
  db.add('job_runs', { job: 'replay_sweeper', interval_seconds: 60, started_at: '2026-10-14T06:59:00Z', finished_at: null, ok: null, error: null, summary: {} });
  return db;
}
beforeEach(seed);

const ids = (r: { json: () => { rows: { id: string }[] } }) => r.json().rows.map((x) => x.id);

describe('who may call', () => {
  it('owner and staff are refused, anonymous is 401, the pilot token and a platform admin pass', async () => {
    for (const url of ['/api/v1/platform/audit', '/api/v1/platform/jobs', '/api/v1/platform/admins']) {
      expect((await app.inject({ method: 'GET', url, headers: jwt('jwt.owner.sig') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url, headers: jwt('jwt.staff.sig') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: adminToken })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url, headers: fazal })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: jwt('jwt.owner.sig'), payload: { email: 'x@y.pk' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/platform/admins/PA2', headers: jwt('jwt.owner.sig') })).statusCode).toBe(403);
    expect(fake.db.rows('platform_admins')).toHaveLength(2);
  });
});

describe('GET /api/v1/platform/audit', () => {
  it('lists newest first with the shop name, and no merchants object', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/audit', headers: fazal });
    expect(r.statusCode).toBe(200);
    expect(ids(r)).toEqual(['A5', 'A4', 'A3', 'A2', 'A1']);
    const rows = r.json().rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ businessName: 'Ali Store', action: 'product_created', diff: { name: 'Cap' } });
    expect(rows[1]).toMatchObject({ businessName: null, actor: 'system' });
    expect(rows[0]).not.toHaveProperty('merchants');
    expect(r.json().nextBefore).toBeNull();
  });

  it('filters by shop and by action', async () => {
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?merchantId=M1', headers: fazal }))).toEqual(['A5', 'A3', 'A1']);
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?action=product_created', headers: fazal }))).toEqual(['A5', 'A1']);
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?merchantId=M2&action=product_created', headers: fazal }))).toEqual([]);
  });

  it('pages by created_at: a full page returns nextBefore, and before= returns the older rows', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/v1/platform/audit?limit=2', headers: fazal });
    expect(ids(first)).toEqual(['A5', 'A4']);
    const before = first.json().nextBefore as string;
    expect(before).toBe(fake.db.rows('audit_log').find((a) => a.id === 'A4')!.created_at);
    const second = await app.inject({ method: 'GET', url: `/api/v1/platform/audit?limit=2&before=${encodeURIComponent(before)}`, headers: fazal });
    expect(ids(second)).toEqual(['A3', 'A2']);
    const third = await app.inject({ method: 'GET', url: `/api/v1/platform/audit?limit=2&before=${encodeURIComponent(second.json().nextBefore)}`, headers: fazal });
    expect(ids(third)).toEqual(['A1']);
    expect(third.json().nextBefore).toBeNull();
  });

  it('clamps limit to 1–100 and ignores junk', async () => {
    for (let i = 0; i < 120; i++) fake.db.add('audit_log', { merchant_id: 'M1', actor: 'merchant', action: 'bulk', entity: 'x', diff: {} });
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?limit=500', headers: fazal }))).toHaveLength(100);
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?limit=0', headers: fazal }))).toHaveLength(50); // 0 is not a page size: the default applies
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?limit=1', headers: fazal }))).toHaveLength(1);
    expect(ids(await app.inject({ method: 'GET', url: '/api/v1/platform/audit?limit=abc', headers: fazal }))).toHaveLength(50);
  });
});

describe('GET /api/v1/platform/jobs', () => {
  it('returns the heartbeat rows as stored, ordered by job', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/jobs', headers: fazal });
    expect(r.statusCode).toBe(200);
    const jobs = r.json().jobs as { job: string; ok: boolean | null; finished_at: string | null }[];
    expect(jobs.map((j) => j.job)).toEqual(['billing', 'replay_sweeper']);
    expect(jobs[0]).toMatchObject({ ok: true, summary: { warned: 0 } });
    expect(jobs[1]).toMatchObject({ ok: null, finished_at: null });
  });
});

describe('platform admins (F2)', () => {
  it('lists them with the bound/invited distinction', async () => {
    fake.db.add('platform_admins', { id: 'PA3', auth_user_id: null, email: 'new@sahulatcart.com', name: null, is_active: true });
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/admins', headers: fazal });
    const admins = r.json().admins as { id: string; auth_user_id: string | null }[];
    expect(admins.map((a) => a.id)).toEqual(['PA1', 'PA2', 'PA3']);
    expect(admins[2]!.auth_user_id).toBeNull();
  });

  it('add: validates, lowercases, inserts an unbound row and writes an audit row', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: fazal, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: fazal, payload: { email: 'not-an-email' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: fazal, payload: { email: `${'a'.repeat(250)}@x.pk` } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: fazal, payload: { email: '  New.Admin@Sahulatcart.com ', name: 'New Admin' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, reactivated: false });
    const row = fake.db.rows('platform_admins').find((a) => a.email === 'new.admin@sahulatcart.com')!;
    expect(row).toMatchObject({ name: 'New Admin', auth_user_id: null, is_active: true });
    expect(fake.db.rows('audit_log').at(-1)).toMatchObject({ merchant_id: null, actor: 'platform', user_id: 'user-fazal', action: 'platform_admin_added', entity: 'platform_admin', entity_id: row.id, diff: { email: 'new.admin@sahulatcart.com' } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: fazal, payload: { email: 'NEW.ADMIN@sahulatcart.com' } })).statusCode).toBe(409);
  });

  it('add on an inactive email reactivates it', async () => {
    fake.db.add('platform_admins', { id: 'PA3', auth_user_id: 'user-old', email: 'old@sahulatcart.com', name: 'Old', is_active: false });
    const r = await app.inject({ method: 'POST', url: '/api/v1/platform/admins', headers: fazal, payload: { email: 'old@sahulatcart.com' } });
    expect(r.json()).toMatchObject({ ok: true, id: 'PA3', reactivated: true });
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA3')).toMatchObject({ is_active: true, auth_user_id: 'user-old', name: 'Old' });
    expect(fake.db.rows('platform_admins')).toHaveLength(3);
  });

  it('remove: self 409, last 409, unknown 404, another → inactive plus audit row', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/platform/admins/PA1', headers: fazal })).json().error.code).toBe('self');
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/platform/admins/NOPE', headers: fazal })).statusCode).toBe(404);
    const r = await app.inject({ method: 'DELETE', url: '/api/v1/platform/admins/PA2', headers: fazal });
    expect(r.statusCode).toBe(200);
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA2')!.is_active).toBe(false);
    expect(fake.db.rows('audit_log').at(-1)).toMatchObject({ action: 'platform_admin_removed', entity_id: 'PA2', user_id: 'user-fazal', diff: { email: 'uzair@sahulatcart.com' } });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/platform/admins/PA2', headers: fazal })).statusCode).toBe(409);
    // Fazal is now the only active admin: nobody can remove him, not even the pilot token (which passes the self check).
    const last = await app.inject({ method: 'DELETE', url: '/api/v1/platform/admins/PA1', headers: adminToken });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('last_admin');
    expect(fake.db.rows('platform_admins').find((a) => a.id === 'PA1')!.is_active).toBe(true);
  });
});

describe("the founders' inbox (U2)", () => {
  const seedInbox = () => {
    fake.db.add('platform_notifications', { id: 'N1', kind: 'invoice_claimed', merchant_id: 'M1', title: 'Ali Store: Invoice claimed', body: 'Reference TRX1', data: { invoiceId: 'I1' }, read_at: null });
    fake.db.add('platform_notifications', { id: 'N2', kind: 'job_failed', merchant_id: null, title: 'Job failed: billing', body: 'boom', data: { job: 'billing' }, read_at: null });
    fake.db.add('platform_notifications', { id: 'N3', kind: 'plan_requested', merchant_id: 'M2', title: 'Bilal Mobiles: Plan change requested', body: 'pilot → pro', data: { plan: 'pro' }, read_at: '2026-10-14T05:00:00Z' });
  };
  it('counts the unread rows', async () => {
    seedInbox();
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/inbox?count=1', headers: fazal });
    expect(r.json()).toEqual({ unread: 2 });
  });
  it('lists newest first with the shop name', async () => {
    seedInbox();
    const r = await app.inject({ method: 'GET', url: '/api/v1/platform/inbox', headers: fazal });
    expect(r.statusCode).toBe(200);
    const n = r.json().notifications;
    expect(n.map((x: { id: string }) => x.id)).toEqual(['N3', 'N2', 'N1']);
    expect(n[2]).toMatchObject({ businessName: 'Ali Store', kind: 'invoice_claimed', read_at: null });
    expect(n[1].businessName).toBeNull();
  });
  it('marks some by id, then all; an owner may not', async () => {
    seedInbox();
    let r = await app.inject({ method: 'POST', url: '/api/v1/platform/inbox/read', headers: fazal, payload: { ids: ['N1'] } });
    expect(r.statusCode).toBe(200);
    expect(fake.db.rows('platform_notifications').find((x) => x.id === 'N1')!.read_at).toBeTruthy();
    expect(fake.db.rows('platform_notifications').find((x) => x.id === 'N2')!.read_at).toBeNull();
    r = await app.inject({ method: 'POST', url: '/api/v1/platform/inbox/read', headers: adminToken, payload: {} });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/inbox?count=1', headers: fazal })).json()).toEqual({ unread: 0 });
    expect((await app.inject({ method: 'POST', url: '/api/v1/platform/inbox/read', headers: fazal, payload: { ids: 'N1' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/inbox', headers: jwt('jwt.owner.sig') })).statusCode).toBe(403);
  });
});

describe('sign-up settings (U3)', () => {
  it('GET reports env until a PUT stores values, then the panel is the source', async () => {
    let r = await app.inject({ method: 'GET', url: '/api/v1/platform/signup', headers: fazal });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ open: false, allowlist: [], source: { open: 'env', allowlist: 'env' } });
    r = await app.inject({ method: 'PUT', url: '/api/v1/platform/signup', headers: fazal, payload: { open: true, allowlist: [' Ali@Shop.pk ', 'ali@shop.pk', 'bilal@shop.pk'] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, open: true, count: 2 });
    r = await app.inject({ method: 'GET', url: '/api/v1/platform/signup', headers: fazal });
    expect(r.json()).toEqual({ open: true, allowlist: ['ali@shop.pk', 'bilal@shop.pk'], source: { open: 'db', allowlist: 'db' } });
    const audit = fake.db.rows('audit_log').find((a) => a.action === 'signup_settings_changed')!;
    expect(audit).toMatchObject({ actor: 'platform', user_id: 'user-fazal', entity: 'platform_settings', diff: { open: true, count: 2 } });
    expect(JSON.stringify(audit.diff)).not.toContain('shop.pk');
  });
  it('validates: a non-boolean, a bad email, 501 emails; an owner may not', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/platform/signup', headers: fazal, payload: { open: 'yes', allowlist: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/platform/signup', headers: fazal, payload: { open: false, allowlist: ['not-an-email'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/platform/signup', headers: fazal, payload: { open: false, allowlist: Array.from({ length: 501 }, (_, i) => `u${i}@x.pk`) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/platform/signup', headers: jwt('jwt.owner.sig'), payload: { open: true, allowlist: [] } })).statusCode).toBe(403);
    expect(fake.db.rows('platform_settings')).toHaveLength(0);
  });
});
