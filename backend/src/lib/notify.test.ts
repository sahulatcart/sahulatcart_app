// notify() fan-out (P3): per-member preferences, a dead push subscription is deleted, more than five
// emails in five minutes become one digest, and a channel failure never reaches the caller.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeDb } from '../test-support/fake-db';

const push = vi.hoisted(() => ({ sent: [] as { endpoint: string; title: string; id?: string }[], result: 'ok' as 'ok' | 'gone' | 'failed', configured: true }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string[]; subject: string }[], ok: true, configured: true, throwOnce: false }));

vi.mock('./push', () => ({
  isPushConfigured: () => push.configured,
  sendPush: async (t: { endpoint: string }, p: { title: string; id?: string }) => { push.sent.push({ endpoint: t.endpoint, title: p.title, id: p.id }); return push.result; },
}));
vi.mock('./email', async (importOriginal) => {
  const real = await importOriginal<typeof import('./email')>();
  return {
    ...real,
    isEmailConfigured: () => mail.configured,
    sendEmail: async (m: { to: string[]; subject: string }) => {
      if (mail.throwOnce) { mail.throwOnce = false; throw new Error('smtp down'); }
      mail.sent.push({ to: m.to, subject: m.subject });
      return mail.ok;
    },
  };
});

import { _resetNotifyState, flushNotifications, flushPendingDigests, notificationUrl, notify, prefsOf } from './notify';

const M = 'merchant-1';
let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  Object.assign(push, { sent: [], result: 'ok', configured: true });
  Object.assign(mail, { sent: [], ok: true, configured: true, throwOnce: false });
  _resetNotifyState();
  db.add('merchant_users', { id: 'owner', merchant_id: M, role: 'owner', is_active: true, email: 'owner@shop.pk', notification_prefs: null });
  db.add('merchant_users', { id: 'manager', merchant_id: M, role: 'manager', is_active: true, email: 'mgr@shop.pk', notification_prefs: { push: false, email: true } });
  db.add('merchant_users', { id: 'staff', merchant_id: M, role: 'staff', is_active: true, email: 'staff@shop.pk', notification_prefs: null });
  db.add('merchant_users', { id: 'other', merchant_id: 'merchant-2', role: 'owner', is_active: true, email: 'other@shop.pk', notification_prefs: null });
  db.add('push_subscriptions', { id: 's1', merchant_id: M, member_id: 'owner', endpoint: 'https://push/owner-phone', p256dh: 'k', auth: 'a' });
  db.add('push_subscriptions', { id: 's2', merchant_id: M, member_id: 'manager', endpoint: 'https://push/manager-phone', p256dh: 'k', auth: 'a' });
});
afterEach(() => { vi.useRealTimers(); _resetNotifyState(); });

const send = (title = 'New order', data: Record<string, unknown> = { orderId: 'o1' }) =>
  notify(db.client, M, { type: 'new_order', title, body: 'Rs 2,500 — Ali', data });

describe('prefsOf / notificationUrl', () => {
  it('defaults both channels on; an explicit false turns one off', () => {
    expect(prefsOf(null)).toEqual({ push: true, email: true });
    expect(prefsOf({ push: false })).toEqual({ push: false, email: true });
  });
  it('leads to the order, the inbox, the WhatsApp page, or the list', () => {
    expect(notificationUrl({ type: 'new_order', data: { orderId: 'o1' } })).toBe('/orders/o1');
    expect(notificationUrl({ type: 'takeover_request', data: { conversationId: 'c1' } })).toBe('/inbox');
    expect(notificationUrl({ type: 'template_status', data: {} })).toBe('/settings/whatsapp');
    expect(notificationUrl({ type: 'system', data: { action: 'reconnect_whatsapp' } })).toBe('/settings/whatsapp');
    expect(notificationUrl({ type: 'system' })).toBe('/notifications');
  });
});

describe('notify()', () => {
  it('writes the portal row first and returns its id', async () => {
    const id = await send();
    expect(id).toBeTruthy();
    expect(db.rows('notifications')[0]).toMatchObject({ merchant_id: M, type: 'new_order', title: 'New order', channel: 'portal' });
    await flushNotifications();
  });

  it('fans out by each owner/manager\'s prefs; staff and other shops get nothing', async () => {
    await send();
    await flushNotifications();
    // Push: owner (default on) yes, manager (push:false) no, staff never.
    expect(push.sent.map((p) => p.endpoint)).toEqual(['https://push/owner-phone']);
    // Email: owner and manager, one email with both addresses.
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to.sort()).toEqual(['mgr@shop.pk', 'owner@shop.pk']);
    expect(mail.sent[0]!.subject).toBe('New order');
    expect(db.rows('push_subscriptions').find((s) => s.id === 's1')!.last_used_at).toBeTruthy();
  });

  it('a 410 from the push service deletes that subscription', async () => {
    push.result = 'gone';
    await send();
    await flushNotifications();
    expect(db.rows('push_subscriptions').map((s) => s.id)).toEqual(['s2']);
  });

  it('skips a channel that is not configured', async () => {
    push.configured = false;
    mail.configured = false;
    await send();
    await flushNotifications();
    expect(push.sent).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
    expect(db.rows('notifications')).toHaveLength(1);
  });

  it('an email failure never reaches the caller, and the row is still written', async () => {
    mail.throwOnce = true;
    await expect(send()).resolves.toBeTruthy();
    await expect(flushNotifications()).resolves.toBeUndefined();
    expect(db.rows('notifications')).toHaveLength(1);
  });

  it('more than five in five minutes: the rest become one digest when the window closes', async () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 8; i++) { await send(`Order ${i}`); await flushNotifications(); }
    expect(mail.sent.map((m) => m.subject)).toEqual(['Order 1', 'Order 2', 'Order 3', 'Order 4', 'Order 5']);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(mail.sent).toHaveLength(6);
    expect(mail.sent[5]!.subject).toBe('3 new notifications — Sahulatcart');
    // Push is not batched: every notification still reached the phone.
    expect(push.sent).toHaveLength(8);
    // After the digest the merchant gets individual emails again.
    await send('Order 9'); await flushNotifications();
    expect(mail.sent.at(-1)!.subject).toBe('Order 9');
  });
});

describe('review fixes (P3-6, P3-7)', () => {
  it('the push payload carries the row id, so the service worker can give each alert its own tag', async () => {
    const id = await send();
    await flushNotifications();
    expect(push.sent[0]!.id).toBe(id);
  });

  it('flushPendingDigests() sends what is queued at once — a deploy does not drop five minutes of emails', async () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 7; i++) { await send(`Order ${i}`); await flushNotifications(); }
    expect(mail.sent).toHaveLength(5);
    await flushPendingDigests();
    expect(mail.sent).toHaveLength(6);
    expect(mail.sent[5]!.subject).toBe('2 new notifications — Sahulatcart');
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(mail.sent).toHaveLength(6); // the cancelled timer does not send a second, empty digest
  });

  it('one queued item is "1 new notification", not "notifications"', async () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 6; i++) { await send(`Order ${i}`); await flushNotifications(); }
    await flushPendingDigests();
    expect(mail.sent.at(-1)!.subject).toBe('1 new notification — Sahulatcart');
  });
});
