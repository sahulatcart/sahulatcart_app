// P3 routes over FakeDb through app.inject(): subscriptions, prefs, and "send me a test".
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

const fake = new FakeDb();
const push = vi.hoisted(() => ({ sent: 0, result: 'ok' as 'ok' | 'gone' }));
vi.mock('../lib/push', () => ({ isPushConfigured: () => true, sendPush: async () => { push.sent++; return push.result; } }));
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.client,
  getAnonClient: () => ({
    auth: { getUser: async (token: string) => (token === 'jwt.owner.sig' ? { data: { user: { id: 'u-owner', email: 'owner@shop.pk', user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
  }),
}));

let app: FastifyInstance;
const owner = { authorization: 'Bearer jwt.owner.sig' };
beforeAll(async () => {
  fake.add('merchants', { id: 'M', business_name: 'Shop', settings: {} });
  fake.add('merchant_users', { id: 'member-1', merchant_id: 'M', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'owner@shop.pk', notification_prefs: null });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

describe('push subscriptions', () => {
  it('refuses a malformed subscription', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { endpoint: 'http://not-https', keys: {} } });
    expect(r.statusCode).toBe(400);
  });
  it('stores one row per endpoint, replacing it when the same device subscribes again', async () => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p1', auth: 'a1' }, userAgent: 'Android Chrome' };
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: sub });
    expect(r.statusCode).toBe(200);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { ...sub, keys: { p256dh: 'p2', auth: 'a2' } } });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('push_subscriptions')).toHaveLength(1);
    expect(fake.rows('push_subscriptions')[0]).toMatchObject({ member_id: 'member-1', merchant_id: 'M', p256dh: 'p2' });
  });
  it('the prefs read counts the member\'s devices and says which channels the server has', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/notification-prefs', headers: owner });
    expect(r.json()).toMatchObject({ prefs: { push: true, email: true }, email: 'owner@shop.pk', pushSubscriptions: 1, channels: { push: true, email: false } });
  });
  it('a test push goes to the member\'s devices', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'push' } });
    expect(r.json()).toEqual({ ok: true, sent: 1 });
  });
  it('a test email is refused while email is not configured (409), and a bad channel is 400', async () => {
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'email' } });
    expect(r.statusCode).toBe(409);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'sms' } });
    expect(r.statusCode).toBe(400);
  });
  it('unsubscribing deletes the row', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { endpoint: 'https://push.example/abc' } });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('push_subscriptions')).toHaveLength(0);
  });
});

describe('preferences', () => {
  it('turns a channel off and keeps the other', async () => {
    let r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/notification-prefs', headers: owner, payload: { email: false } });
    expect(r.json()).toEqual({ prefs: { push: true, email: false } });
    r = await app.inject({ method: 'PATCH', url: '/api/v1/admin/notification-prefs', headers: owner, payload: { push: 'yes' } });
    expect(r.statusCode).toBe(400);
    expect(fake.rows('merchant_users')[0]!.notification_prefs).toEqual({ push: true, email: false });
  });
});
