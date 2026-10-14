import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { requirePlatformAdmin } from '../lib/auth';

/**
 * /api/v1/platform/* — the founders' panel beyond the shop list (docs/launch/PLATFORM-PANEL-FAZAL.md).
 * F1: the audit-log reader and the job heartbeats. F2: platform admins invited by email.
 * Uzair's U2 (inbox) and U3 (sign-up settings) append their routes to this file.
 * Guarded like routes/platform.ts: a `platform_admins` JWT or the pilot ADMIN_API_TOKEN.
 */

const MAX_PAGE = 100;
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MAX_EMAIL = 254;
const MAX_NAME = 80;

const bad = (message: string) => ({ error: { code: 'BAD', message } });

export async function platformOpsRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requirePlatformAdmin);

  // ── F1: audit log, newest first, keyset paging on created_at ──
  app.get('/api/v1/platform/audit', async (req, reply) => {
    const q = (req.query ?? {}) as { merchantId?: string; action?: string; before?: string; limit?: string };
    const limit = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(q.limit ?? '', 10) || 50));
    let query = db
      .from('audit_log')
      .select('id, merchant_id, actor, user_id, action, entity, entity_id, diff, created_at, merchants(business_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q.merchantId) query = query.eq('merchant_id', q.merchantId);
    if (q.action) query = query.eq('action', q.action.trim());
    if (q.before) query = query.lt('created_at', q.before);
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: { code: 'DB', message: 'could not read the audit log' } });
    const rows = (data ?? []).map((r) => {
      const { merchants, ...rest } = r as typeof r & { merchants?: { business_name?: string } | null };
      return { ...rest, businessName: merchants?.business_name ?? null };
    });
    const nextBefore = rows.length === limit ? (rows[rows.length - 1]!.created_at as string) : null;
    return reply.send({ rows, nextBefore });
  });

  app.get('/api/v1/platform/jobs', async (_req, reply) => {
    const { data, error } = await db.from('job_runs').select('*').order('job', { ascending: true });
    if (error) return reply.code(500).send({ error: { code: 'DB', message: 'could not read job runs (is migration 0020 applied?)' } });
    return reply.send({ jobs: data ?? [] });
  });

  // ── U2: the founders' inbox (platform_notifications, written by notifyPlatform) ──
  app.get('/api/v1/platform/inbox', async (req, reply) => {
    if ((req.query as { count?: string } | undefined)?.count === '1') {
      const { count } = await db.from('platform_notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
      return reply.send({ unread: count ?? 0 });
    }
    const { data, error } = await db
      .from('platform_notifications')
      .select('id, kind, merchant_id, title, body, data, read_at, created_at, merchants(business_name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return reply.code(500).send({ error: { code: 'DB', message: 'could not read the inbox (is migration 0020 applied?)' } });
    const notifications = (data ?? []).map((r) => {
      const { merchants, ...rest } = r as typeof r & { merchants?: { business_name?: string } | null };
      return { ...rest, businessName: merchants?.business_name ?? null };
    });
    return reply.send({ notifications });
  });

  app.post('/api/v1/platform/inbox/read', async (req, reply) => {
    const ids = (req.body as { ids?: unknown } | undefined)?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > MAX_PAGE || !ids.every((x) => typeof x === 'string'))) return reply.code(400).send(bad('ids must be up to 100 strings'));
    let q = db.from('platform_notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (Array.isArray(ids)) q = q.in('id', ids as string[]);
    const { error } = await q;
    if (error) return reply.code(500).send({ error: { code: 'DB', message: 'could not mark the inbox read' } });
    return reply.send({ ok: true });
  });

  // ── F2: platform admins, invited by email and bound at their first confirmed login (lib/auth.ts) ──
  app.get('/api/v1/platform/admins', async (_req, reply) => {
    const { data } = await db.from('platform_admins').select('id, name, email, is_active, auth_user_id, created_at').order('created_at', { ascending: true });
    return reply.send({ admins: data ?? [] });
  });

  app.post('/api/v1/platform/admins', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: unknown; name?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return reply.code(400).send(bad('a valid email is required'));
    const name = (typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '') || null;
    const by = req.platformCtx!.authUserId;
    const existing = await db.from('platform_admins').select('id, is_active').eq('email', email).maybeSingle();
    let id: string;
    let reactivated = false;
    if (existing.data) {
      if (existing.data.is_active) return reply.code(409).send({ error: { code: 'ALREADY', message: 'already a platform admin' } });
      await db.from('platform_admins').update({ is_active: true, ...(name ? { name } : {}), updated_at: new Date().toISOString() }).eq('id', existing.data.id);
      id = existing.data.id as string;
      reactivated = true;
    } else {
      const { data, error } = await db.from('platform_admins').insert({ email, name, auth_user_id: null, is_active: true }).select('id').single();
      if (error || !data) return reply.code(500).send({ error: { code: 'DB', message: 'could not add the admin' } });
      id = data.id as string;
    }
    await db.from('audit_log').insert({ merchant_id: null, actor: 'platform', user_id: by, action: 'platform_admin_added', entity: 'platform_admin', entity_id: id, diff: { email, reactivated } });
    return reply.send({ ok: true, id, reactivated });
  });

  app.delete('/api/v1/platform/admins/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.platformCtx!.authUserId;
    const { data: row } = await db.from('platform_admins').select('id, email, auth_user_id, is_active').eq('id', id).maybeSingle();
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'admin not found' } });
    if (!row.is_active) return reply.code(409).send({ error: { code: 'ALREADY', message: 'already inactive' } });
    if (me && row.auth_user_id === me) return reply.code(409).send({ error: { code: 'self', message: 'You cannot remove yourself' } });
    const active = await db.from('platform_admins').select('id', { count: 'exact', head: true }).eq('is_active', true);
    if ((active.count ?? 0) <= 1) return reply.code(409).send({ error: { code: 'last_admin', message: 'The last platform admin cannot be removed' } });
    await db.from('platform_admins').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    await db.from('audit_log').insert({ merchant_id: null, actor: 'platform', user_id: me, action: 'platform_admin_removed', entity: 'platform_admin', entity_id: id, diff: { email: row.email } });
    return reply.send({ ok: true });
  });
}
