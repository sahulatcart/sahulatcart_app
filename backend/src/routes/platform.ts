import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { requirePlatformAdmin } from '../lib/auth';
import { periodMonth } from '../lib/usage';
import { notify } from '../lib/notify';

/**
 * /api/v1/platform/* — the platform owner's console (SRS-Fazal M6). Every shop, its connection,
 * and a suspend switch. Guarded by requirePlatformAdmin(): a JWT in `platform_admins` (with or
 * without a shop of their own) or the pilot ADMIN_API_TOKEN. No impersonation: the console reads
 * summaries, it never acts inside a shop.
 */

const MAX_REASON = 300;

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requirePlatformAdmin);

  app.get('/api/v1/platform/me', async (req, reply) => {
    const p = req.platformCtx!;
    return reply.send({ isPlatformAdmin: true, email: p.email, via: p.via, merchantId: req.merchantCtx?.merchantId ?? null });
  });

  app.get('/api/v1/platform/merchants', async (req, reply) => {
    const q = String((req.query as { q?: string } | undefined)?.q ?? '').trim().toLowerCase();
    const month = periodMonth();
    const monthStart = new Date(`${month}-01T00:00:00+05:00`).toISOString();
    const { data: merchants } = await db
      .from('merchants')
      .select('id, business_name, email, phone, status, plan, created_at, settings')
      .order('created_at', { ascending: false })
      .limit(100);
    const rows = (merchants ?? []).filter((m) => !q || `${m.business_name ?? ''} ${m.email ?? ''} ${m.phone ?? ''}`.toLowerCase().includes(q));
    // A few small queries per shop; the console lists at most 100 shops and is opened by one person.
    const out = await Promise.all(rows.map(async (m) => {
      const [num, owner, conv, orders, usage] = await Promise.all([
        db.from('whatsapp_numbers').select('status, phone_e164, quality_rating, flag_reason').eq('merchant_id', m.id).neq('status', 'disconnected').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('merchant_users').select('email').eq('merchant_id', m.id).eq('role', 'owner').limit(1).maybeSingle(),
        db.from('conversations').select('last_message_at').eq('merchant_id', m.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
        db.from('orders').select('id', { count: 'exact', head: true }).eq('merchant_id', m.id).not('order_number', 'is', null).gte('created_at', monthStart),
        db.from('message_usage').select('outbound_count').eq('merchant_id', m.id).eq('period_month', month),
      ]);
      const suspension = (m.settings as { suspension?: { reason?: string; at?: string } } | null)?.suspension ?? null;
      return {
        id: m.id,
        businessName: m.business_name,
        ownerEmail: owner.data?.email ?? m.email ?? null,
        phone: m.phone ?? null,
        status: m.status,
        plan: m.plan,
        createdAt: m.created_at,
        connection: num.data ? { status: num.data.status, phone: num.data.phone_e164, quality: num.data.quality_rating, flagReason: num.data.flag_reason } : { status: 'none' },
        lastInboundAt: conv.data?.last_message_at ?? null,
        ordersThisMonth: orders.count ?? 0,
        outboundThisMonth: (usage.data ?? []).reduce((s, u) => s + (u.outbound_count ?? 0), 0),
        suspension,
      };
    }));
    return reply.send({ month, merchants: out });
  });

  app.get('/api/v1/platform/merchants/:id/attempts', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data } = await db
      .from('whatsapp_connect_attempts')
      .select('id, status, waba_id, phone_number_id, error_code, error_message, created_at, updated_at')
      .eq('merchant_id', id)
      .order('created_at', { ascending: false })
      .limit(10);
    return reply.send({ attempts: data ?? [] });
  });

  /** FR-M6.3/6.5 — suspend: the bot goes silent, the portal shows the reason, an audit row is written. */
  app.post('/api/v1/platform/merchants/:id/suspend', async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = String((req.body as { reason?: unknown } | undefined)?.reason ?? '').trim();
    if (!reason || reason.length > MAX_REASON) return reply.code(400).send({ error: { code: 'BAD', message: `reason is required (max ${MAX_REASON} characters)` } });
    const { data: m } = await db.from('merchants').select('id, settings, status').eq('id', id).maybeSingle();
    if (!m) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'merchant not found' } });
    if (m.status === 'suspended') return reply.code(409).send({ error: { code: 'ALREADY', message: 'already suspended' } });
    const at = new Date().toISOString();
    const by = req.platformCtx!.email ?? req.platformCtx!.via;
    await db.from('merchants').update({ status: 'suspended', settings: { ...(m.settings as object), suspension: { reason, at, by } } }).eq('id', id);
    await db.from('audit_log').insert({ merchant_id: id, actor: 'platform', user_id: req.platformCtx!.authUserId, action: 'suspend', entity: 'merchant', entity_id: id, diff: { reason, by } });
    await notify(db, id, { type: 'system', title: 'Your shop has been suspended', body: `Reason: ${reason}. The bot is not replying and the portal is read-only. Contact support to resolve this.`, data: { action: 'suspended' } });
    return reply.send({ ok: true, status: 'suspended' });
  });

  app.post('/api/v1/platform/merchants/:id/unsuspend', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data: m } = await db.from('merchants').select('id, settings, status').eq('id', id).maybeSingle();
    if (!m) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'merchant not found' } });
    if (m.status !== 'suspended') return reply.code(409).send({ error: { code: 'NOT_SUSPENDED', message: 'not suspended' } });
    const settings = { ...(m.settings as Record<string, unknown>) };
    delete settings.suspension;
    await db.from('merchants').update({ status: 'active', settings }).eq('id', id);
    await db.from('audit_log').insert({ merchant_id: id, actor: 'platform', user_id: req.platformCtx!.authUserId, action: 'unsuspend', entity: 'merchant', entity_id: id, diff: {} });
    await notify(db, id, { type: 'system', title: 'Your shop is active again', body: 'The suspension has been lifted. The bot is replying and the portal works normally.', data: { action: 'unsuspended' } });
    return reply.send({ ok: true, status: 'active' });
  });
}
