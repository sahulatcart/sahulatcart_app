// Merchant alerts (SRS P3): push subscriptions, per-member channel preferences, and "send me a test".
// Own route file with its own auth hook (Part 0.3). The notification list itself stays in admin.ts.
// Only owners and managers are ever alerted (lib/notify.ts), so only they may manage any of this.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig, portalOrigin } from '../config';
import { logger } from '../lib/logger';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { DEFAULT_PREFS, prefsOf, type Prefs } from '../lib/notify';
import { isPushConfigured, sendPush } from '../lib/push';
import { isEmailConfigured, renderAlert, sendEmail } from '../lib/email';

/** Alerts go to a person: a manager-level portal login (merchant_users row), never the shared admin token. */
function memberOr4xx(req: FastifyRequest, reply: FastifyReply): string | null {
  const ctx = req.merchantCtx!;
  if (!isManager(ctx)) { forbid(reply); return null; }
  if (!ctx.memberId) { reply.code(400).send({ error: { code: 'NO_MEMBER', message: 'Sign in to the portal to manage alerts' } }); return null; }
  return ctx.memberId;
}

/** Push services we will ever POST to; anything else is refused when the browser hands it in (review P3-5). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const MAX_ENDPOINT = 1024;
const MAX_KEY = 256;
export function validPushEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > MAX_ENDPOINT) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch { return false; }
}

/** One test per member per 30 s, so a looped tab cannot burn the shared email quota (review P3-4). */
const TEST_COOLDOWN_MS = 30_000;
const lastTest = new Map<string, number>();

const dbError = (reply: FastifyReply, what: string, message: string) => {
  logger.warn({ err: message }, `${what} failed`);
  return reply.code(400).send({ error: { code: 'DB', message: 'Could not save. Please try again.' } });
};

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  // ── Preferences: which channels this member wants. ──
  app.get('/api/v1/admin/notification-prefs', async (req, reply) => {
    const memberId = memberOr4xx(req, reply);
    if (!memberId) return;
    const [m, subs] = await Promise.all([
      db.from('merchant_users').select('email, notification_prefs').eq('id', memberId).maybeSingle(),
      db.from('push_subscriptions').select('id').eq('member_id', memberId),
    ]);
    return reply.send({
      prefs: prefsOf(m.data?.notification_prefs),
      email: m.data?.email ?? null,
      pushSubscriptions: subs.data?.length ?? 0,
      channels: { push: isPushConfigured(), email: isEmailConfigured() },
    });
  });

  app.patch('/api/v1/admin/notification-prefs', async (req, reply) => {
    const memberId = memberOr4xx(req, reply);
    if (!memberId) return;
    const b = (req.body ?? {}) as Partial<Record<keyof Prefs, unknown>>;
    for (const k of ['push', 'email'] as const) if (k in b && typeof b[k] !== 'boolean') return reply.code(400).send({ error: { code: 'BAD', message: `${k} must be true or false` } });
    const cur = await db.from('merchant_users').select('notification_prefs').eq('id', memberId).maybeSingle();
    const prefs: Prefs = { ...DEFAULT_PREFS, ...prefsOf(cur.data?.notification_prefs), ...(typeof b.push === 'boolean' ? { push: b.push } : {}), ...(typeof b.email === 'boolean' ? { email: b.email } : {}) };
    const { error } = await db.from('merchant_users').update({ notification_prefs: prefs }).eq('id', memberId);
    if (error) return dbError(reply, 'prefs update', error.message);
    return reply.send({ prefs });
  });

  // ── Push subscriptions: the browser's PushSubscription, one row per device (FR-P3.2). ──
  app.post('/api/v1/admin/push-subscriptions', async (req, reply) => {
    const memberId = memberOr4xx(req, reply);
    if (!memberId) return;
    const mid = req.merchantCtx!.merchantId;
    const b = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; userAgent?: unknown };
    const p256dh = typeof b.keys?.p256dh === 'string' && b.keys.p256dh.length <= MAX_KEY ? b.keys.p256dh : null;
    const auth = typeof b.keys?.auth === 'string' && b.keys.auth.length <= MAX_KEY ? b.keys.auth : null;
    if (!validPushEndpoint(b.endpoint) || !p256dh || !auth) return reply.code(400).send({ error: { code: 'BAD', message: 'endpoint must be a known push service URL, with keys.p256dh and keys.auth' } });
    // The same device subscribing again (new keys, another login of the same shop) replaces its row;
    // a device already registered to another shop is refused (review P3-12).
    const existing = await db.from('push_subscriptions').select('merchant_id').eq('endpoint', b.endpoint).maybeSingle();
    if (existing.data && existing.data.merchant_id !== mid) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'This device is registered to another shop' } });
    const row = { merchant_id: mid, member_id: memberId, endpoint: b.endpoint, p256dh, auth, user_agent: typeof b.userAgent === 'string' ? b.userAgent.slice(0, 200) : null };
    const { error } = await db.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) return dbError(reply, 'push subscription upsert', error.message);
    return reply.send({ ok: true });
  });

  app.delete('/api/v1/admin/push-subscriptions', async (req, reply) => {
    const memberId = memberOr4xx(req, reply);
    if (!memberId) return;
    const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint ?? (req.query as { endpoint?: unknown }).endpoint;
    if (typeof endpoint !== 'string') return reply.code(400).send({ error: { code: 'BAD', message: 'endpoint required' } });
    const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('member_id', memberId);
    if (error) return dbError(reply, 'push subscription delete', error.message);
    return reply.send({ ok: true });
  });

  // ── "Send me a test": the calling member only, one channel at a time (FR-P3.6). ──
  app.post('/api/v1/admin/notifications/test', async (req, reply) => {
    const memberId = memberOr4xx(req, reply);
    if (!memberId) return;
    const channel = (req.body as { channel?: unknown } | undefined)?.channel;
    if (channel !== 'push' && channel !== 'email') return reply.code(400).send({ error: { code: 'BAD', message: 'channel must be push or email' } });
    const key = `${memberId}:${channel}`;
    const since = Date.now() - (lastTest.get(key) ?? 0);
    if (since < TEST_COOLDOWN_MS) return reply.code(429).send({ error: { code: 'SLOW_DOWN', message: `Wait ${Math.ceil((TEST_COOLDOWN_MS - since) / 1000)} s before another test` } });
    lastTest.set(key, Date.now());
    const cfg = loadConfig();
    if (channel === 'push') {
      if (!isPushConfigured()) return reply.code(409).send({ error: { code: 'NOT_CONFIGURED', message: 'Push is not set up on the server yet (VAPID keys)' } });
      const subs = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('member_id', memberId);
      let sent = 0;
      for (const s of (subs.data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
        const r = await sendPush(s, { title: `Test from ${cfg.PRODUCT_NAME}`, body: 'Phone notifications are working.', url: '/settings/notifications' });
        if (r === 'ok') sent++;
        else if (r === 'gone') await db.from('push_subscriptions').delete().eq('id', s.id);
      }
      return reply.send({ ok: true, sent });
    }
    if (!isEmailConfigured()) return reply.code(409).send({ error: { code: 'NOT_CONFIGURED', message: 'Email is not set up on the server yet (RESEND_API_KEY)' } });
    const m = await db.from('merchant_users').select('email').eq('id', memberId).maybeSingle();
    if (!m.data?.email) return reply.code(400).send({ error: { code: 'NO_EMAIL', message: 'Your account has no email address' } });
    const title = `Test from ${cfg.PRODUCT_NAME}`;
    const r = renderAlert(title, 'Email alerts are working.', `${portalOrigin(cfg)}/settings/notifications`, cfg.PRODUCT_NAME);
    const ok = await sendEmail({ to: [m.data.email], subject: title, text: r.text, html: r.html });
    return reply.send({ ok, sent: ok ? 1 : 0 });
  });
}

/** Tests only. */
export function _resetTestCooldowns(): void { lastTest.clear(); }
