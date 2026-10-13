// P3 routes over FakeDb through app.inject(): subscriptions, prefs, and "send me a test".
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';
import { _resetTestCooldowns, validPushEndpoint } from './notifications';

const fake = new FakeDb();
const push = vi.hoisted(() => ({ sent: 0, result: 'ok' as 'ok' | 'gone' }));
vi.mock('../lib/push', () => ({ isPushConfigured: () => true, sendPush: async () => { push.sent++; return push.result; } }));
const USERS: Record<string, { id: string; email: string }> = {
  'jwt.owner.sig': { id: 'u-owner', email: 'owner@shop.pk' },
  'jwt.staff.sig': { id: 'u-staff', email: 'staff@shop.pk' },
  'jwt.other.sig': { id: 'u-other', email: 'other@shop.pk' },
};
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.client,
  getAnonClient: () => ({
    auth: { getUser: async (token: string) => (USERS[token] ? { data: { user: { ...USERS[token], user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
  }),
}));

let app: FastifyInstance;
const owner = { authorization: 'Bearer jwt.owner.sig' };
const staff = { authorization: 'Bearer jwt.staff.sig' };
const other = { authorization: 'Bearer jwt.other.sig' };
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
beforeAll(async () => {
  fake.add('merchants', { id: 'M', business_name: 'Shop', settings: {} });
  fake.add('merchants', { id: 'M2', business_name: 'Other shop', settings: {} });
  fake.add('merchant_users', { id: 'member-1', merchant_id: 'M', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'owner@shop.pk', notification_prefs: null });
  fake.add('merchant_users', { id: 'member-staff', merchant_id: 'M', auth_user_id: 'u-staff', role: 'staff', is_active: true, email: 'staff@shop.pk', notification_prefs: null });
  fake.add('merchant_users', { id: 'member-other', merchant_id: 'M2', auth_user_id: 'u-other', role: 'owner', is_active: true, email: 'other@shop.pk', notification_prefs: null });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

describe('validPushEndpoint (only the real push services, review P3-5)', () => {
  it('accepts the four push services over https and nothing else', () => {
    expect(validPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(validPushEndpoint('https://web.push.apple.com/x')).toBe(true);
    expect(validPushEndpoint('https://db5p.notify.windows.com/w/?token=x')).toBe(true);
    expect(validPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(validPushEndpoint('https://evil.example/collect')).toBe(false);
    expect(validPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(validPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(1100)}`)).toBe(false);
    expect(validPushEndpoint(42)).toBe(false);
  });
});

describe('push subscriptions', () => {
  it('staff get 403 on every alert route (only owners and managers are alerted)', async () => {
    for (const [method, url] of [['GET', '/api/v1/admin/notification-prefs'], ['PATCH', '/api/v1/admin/notification-prefs'], ['POST', '/api/v1/admin/push-subscriptions'], ['DELETE', '/api/v1/admin/push-subscriptions'], ['POST', '/api/v1/admin/notifications/test']] as const) {
      const r = await app.inject({ method, url, headers: staff, payload: {} });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
  });
  it('refuses a malformed subscription and an unknown push host', async () => {
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { endpoint: 'http://not-https', keys: {} } });
    expect(r.statusCode).toBe(400);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { endpoint: 'https://evil.example/collect', keys: { p256dh: 'p', auth: 'a' } } });
    expect(r.statusCode).toBe(400);
  });
  it('stores one row per endpoint, replacing it when the same device subscribes again', async () => {
    const sub = { endpoint: ENDPOINT, keys: { p256dh: 'p1', auth: 'a1' }, userAgent: 'Android Chrome' };
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: sub });
    expect(r.statusCode).toBe(200);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { ...sub, keys: { p256dh: 'p2', auth: 'a2' } } });
    expect(r.statusCode).toBe(200);
    expect(fake.rows('push_subscriptions')).toHaveLength(1);
    expect(fake.rows('push_subscriptions')[0]).toMatchObject({ member_id: 'member-1', merchant_id: 'M', p256dh: 'p2' });
  });
  it('a device registered to another shop cannot be taken over (403, review P3-12)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/push-subscriptions', headers: other, payload: { endpoint: ENDPOINT, keys: { p256dh: 'x', auth: 'y' } } });
    expect(r.statusCode).toBe(403);
    expect(fake.rows('push_subscriptions')[0]).toMatchObject({ merchant_id: 'M', p256dh: 'p2' });
  });
  it('the prefs read counts the member\'s devices and says which channels the server has', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/notification-prefs', headers: owner });
    expect(r.json()).toMatchObject({ prefs: { push: true, email: true }, email: 'owner@shop.pk', pushSubscriptions: 1, channels: { push: true, email: false } });
  });
  it('a test push goes to the member\'s devices, and a second one within 30 s is 429', async () => {
    _resetTestCooldowns();
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'push' } });
    expect(r.json()).toEqual({ ok: true, sent: 1 });
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'push' } });
    expect(r.statusCode).toBe(429);
  });
  it('a test email is refused while email is not configured (409), and a bad channel is 400', async () => {
    _resetTestCooldowns();
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'email' } });
    expect(r.statusCode).toBe(409);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/notifications/test', headers: owner, payload: { channel: 'sms' } });
    expect(r.statusCode).toBe(400);
  });
  it('unsubscribing deletes the row', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/v1/admin/push-subscriptions', headers: owner, payload: { endpoint: ENDPOINT } });
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
