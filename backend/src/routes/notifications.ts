// Merchant alerts (SRS P3): push subscriptions, per-member channel preferences, and "send me a test".
// Own route file with its own auth hook (Part 0.3). The notification list itself stays in admin.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { requireMerchant } from '../lib/auth';
import { DEFAULT_PREFS, prefsOf, type Prefs } from '../lib/notify';
import { isPushConfigured, sendPush } from '../lib/push';
import { isEmailConfigured, renderAlert, sendEmail } from '../lib/email';

/** Alerts go to a person, so these routes need a portal login (merchant_users row), not the admin token. */
function memberOr400(req: FastifyRequest, reply: FastifyReply): string | null {
  const id = req.merchantCtx!.memberId;
  if (!id) reply.code(400).send({ error: { code: 'NO_MEMBER', message: 'Sign in to the portal to manage alerts' } });
  return id ?? null;
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  // ── Preferences: which channels this member wants (owner/manager only get alerts at all). ──
  app.get('/api/v1/admin/notification-prefs', async (req, reply) => {
    const memberId = memberOr400(req, reply);
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
    const memberId = memberOr400(req, reply);
    if (!memberId) return;
    const b = (req.body ?? {}) as Partial<Record<keyof Prefs, unknown>>;
    for (const k of ['push', 'email'] as const) if (k in b && typeof b[k] !== 'boolean') return reply.code(400).send({ error: { code: 'BAD', message: `${k} must be true or false` } });
    const cur = await db.from('merchant_users').select('notification_prefs').eq('id', memberId).maybeSingle();
    const prefs: Prefs = { ...DEFAULT_PREFS, ...prefsOf(cur.data?.notification_prefs), ...(typeof b.push === 'boolean' ? { push: b.push } : {}), ...(typeof b.email === 'boolean' ? { email: b.email } : {}) };
    const { error } = await db.from('merchant_users').update({ notification_prefs: prefs }).eq('id', memberId);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ prefs });
  });

  // ── Push subscriptions: the browser's PushSubscription, one row per device (FR-P3.2). ──
  app.post('/api/v1/admin/push-subscriptions', async (req, reply) => {
    const memberId = memberOr400(req, reply);
    if (!memberId) return;
    const b = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; userAgent?: unknown };
    const endpoint = typeof b.endpoint === 'string' && /^https:\/\//.test(b.endpoint) ? b.endpoint : null;
    const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : null;
    const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : null;
    if (!endpoint || !p256dh || !auth) return reply.code(400).send({ error: { code: 'BAD', message: 'endpoint and keys.p256dh/keys.auth required' } });
    const row = { merchant_id: req.merchantCtx!.merchantId, member_id: memberId, endpoint, p256dh, auth, user_agent: typeof b.userAgent === 'string' ? b.userAgent.slice(0, 200) : null };
    // The same device subscribing again (new keys, or another login) replaces its row.
    const { error } = await db.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ok: true });
  });

  app.delete('/api/v1/admin/push-subscriptions', async (req, reply) => {
    const memberId = memberOr400(req, reply);
    if (!memberId) return;
    const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint ?? (req.query as { endpoint?: unknown }).endpoint;
    if (typeof endpoint !== 'string') return reply.code(400).send({ error: { code: 'BAD', message: 'endpoint required' } });
    await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('member_id', memberId);
    return reply.send({ ok: true });
  });

  // ── "Send me a test": the calling member only, one channel at a time (FR-P3.6). ──
  app.post('/api/v1/admin/notifications/test', async (req, reply) => {
    const memberId = memberOr400(req, reply);
    if (!memberId) return;
    const channel = (req.body as { channel?: unknown } | undefined)?.channel;
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
    if (channel === 'email') {
      if (!isEmailConfigured()) return reply.code(409).send({ error: { code: 'NOT_CONFIGURED', message: 'Email is not set up on the server yet (RESEND_API_KEY)' } });
      const m = await db.from('merchant_users').select('email').eq('id', memberId).maybeSingle();
      if (!m.data?.email) return reply.code(400).send({ error: { code: 'NO_EMAIL', message: 'Your account has no email address' } });
      const r = renderAlert(`Test from ${cfg.PRODUCT_NAME}`, 'Email alerts are working.', `${cfg.ADMIN_ORIGIN}/settings/notifications`, cfg.PRODUCT_NAME);
      const ok = await sendEmail({ to: [m.data.email], subject: r.text.split('\n')[0]!, text: r.text, html: r.html });
      return reply.send({ ok, sent: ok ? 1 : 0 });
    }
    return reply.code(400).send({ error: { code: 'BAD', message: 'channel must be push or email' } });
  });
}
