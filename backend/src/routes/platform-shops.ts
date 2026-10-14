// U1 (PLATFORM-PANEL-UZAIR.md): the founders' read-only look inside one shop. Own route file with
// its own platform-admin hook. The shop id comes from the URL only, never from req.merchantCtx; an
// unknown id is 404, and so is another shop's conversation under this id (never 403). Nothing here
// writes to orders, conversations, products, customers or merchants: the chat reader never zeroes
// unread_count the way the merchant's inbox does. The one write is the audit row every look leaves
// (rule 3): we are the processor for buyer data, and this is the record of who looked at what.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PLANS, type Plan } from '@app/shared';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { requirePlatformAdmin } from '../lib/auth';
import { botMode, conversationsThisMonth, getSubscription } from '../lib/billing';
import { getUsage } from '../lib/usage';
import { computeReadiness } from '../lib/readiness';
import { productImageUrl } from '../lib/images';
import { getConnectionStatus } from '../whatsapp/connect';

const MERCHANT_COLS = ['id', 'business_name', 'owner_name', 'email', 'phone', 'address', 'category', 'logo_url', 'status', 'plan', 'created_at', 'business_hours', 'bot_persona', 'negotiation_defaults', 'settings'] as const;
const notFound = (reply: FastifyReply, what: string) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: `${what} not found` } });
/** Fail closed: the page promises that every look is recorded, so a look that could not be recorded shows nothing. */
const unrecorded = (reply: FastifyReply) => reply.code(503).send({ error: { code: 'AUDIT_UNAVAILABLE', message: 'This view could not be recorded in the audit log, so it is not shown. Try again in a minute.' } });
/** The columns named in the select, and nothing else: the fake DB returns whole rows, and the real one must never be trusted to hide an account number by accident. */
const pick = (rows: Record<string, unknown>[] | null, cols: readonly string[]) => (rows ?? []).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));

export async function platformShopRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requirePlatformAdmin);

  const shop = async (id: string) => (await db.from('merchants').select('*').eq('id', id).maybeSingle()).data as Record<string, unknown> | null;
  /** Writes the platform_view audit row; false when it could not be written (the caller then shows nothing). */
  const viewed = async (merchantId: string, entity: 'merchant' | 'conversation', entityId: string, userId: string | null): Promise<boolean> => {
    const { error } = await db.from('audit_log').insert({ merchant_id: merchantId, actor: 'platform', user_id: userId, action: 'platform_view', entity, entity_id: entityId, diff: {} });
    if (error) logger.warn({ err: error.message, merchantId, entity, entityId }, 'platform_view audit row not written; view refused');
    return !error;
  };

  app.get('/api/v1/platform/merchants/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await shop(id);
    if (!m) return notFound(reply, 'merchant');
    const [members, banks, zones, sub, convs, usage, readiness, connection, invoices] = await Promise.all([
      db.from('merchant_users').select('id, email, name, role, is_active').eq('merchant_id', id),
      db.from('bank_accounts').select('id, bank_name, account_title, is_default, is_active').eq('merchant_id', id), // never account_number, iban or branch
      db.from('delivery_zones').select('id, area_name, city, charge, is_serviceable, eta_text').eq('merchant_id', id),
      getSubscription(db, id),
      conversationsThisMonth(db, id),
      getUsage(db, id),
      computeReadiness(db, id),
      getConnectionStatus(db, id),
      db.from('invoices').select('id, plan, period_start, period_end, amount_paisa, status, reference, claimed_at, paid_at, created_at').eq('merchant_id', id).order('period_start', { ascending: false }).limit(12),
    ]);
    const plan = (sub?.plan ?? (m.plan as Plan | undefined) ?? 'pilot') as Plan;
    if (!(await viewed(id, 'merchant', id, req.platformCtx!.authUserId))) return unrecorded(reply);
    return reply.send({
      merchant: Object.fromEntries(MERCHANT_COLS.map((c) => [c, m[c] ?? null])),
      members: pick(members.data, ['id', 'email', 'name', 'role', 'is_active']),
      bankAccounts: pick(banks.data, ['id', 'bank_name', 'account_title', 'is_default', 'is_active']),
      zones: pick(zones.data, ['id', 'area_name', 'city', 'charge', 'is_serviceable', 'eta_text']),
      subscription: sub,
      invoices: invoices.data ?? [],
      usage,
      conversationsThisMonth: convs,
      limits: { conversations: PLANS[plan].conversations },
      botMode: botMode(m as { status?: string | null; settings?: { botEnabled?: boolean } | null }, sub, convs),
      readiness,
      connection,
    });
  });

  app.get('/api/v1/platform/merchants/:id/orders', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await shop(id))) return notFound(reply, 'merchant');
    const { status, payment } = req.query as { status?: string; payment?: string };
    let q = db.from('orders').select('id, order_number, status, payment_method, payment_status, total, delivery_name, delivery_area, created_at').eq('merchant_id', id).not('order_number', 'is', null).order('created_at', { ascending: false }).limit(100);
    if (status) q = q.eq('status', status);
    if (payment) q = q.eq('payment_status', payment);
    const { data } = await q;
    return reply.send({ orders: data ?? [] });
  });

  app.get('/api/v1/platform/merchants/:id/conversations', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await shop(id))) return notFound(reply, 'merchant');
    const { data } = await db.from('conversations').select('id, status, current_state, last_message_at, unread_count, customers(name, wa_id, wa_opt_in_status, is_blocked)').eq('merchant_id', id).neq('status', 'closed').order('last_message_at', { ascending: false, nullsFirst: false }).limit(50);
    return reply.send({ conversations: data ?? [] });
  });

  app.get('/api/v1/platform/merchants/:id/conversations/:cid', async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    if (!(await shop(id))) return notFound(reply, 'merchant');
    const convo = await db.from('conversations').select('id, status, current_state, window_expires_at, unread_count, customers(name, wa_id, wa_opt_in_status, is_blocked)').match({ id: cid, merchant_id: id }).maybeSingle();
    if (!convo.data) return notFound(reply, 'conversation');
    const messages = await db.from('messages').select('direction, sender, type, body, status, created_at').eq('conversation_id', cid).order('created_at', { ascending: false }).limit(200);
    if (!(await viewed(id, 'conversation', cid, req.platformCtx!.authUserId))) return unrecorded(reply);
    return reply.send({ conversation: convo.data, messages: (messages.data ?? []).reverse() });
  });

  app.get('/api/v1/platform/merchants/:id/products', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await shop(id))) return notFound(reply, 'merchant');
    const { data } = await db.from('products').select('id, sku, name, description, price, cost, stock, track_stock, is_active, negotiable, max_discount_pct, min_price, images').eq('merchant_id', id).is('deleted_at', null).order('created_at', { ascending: true });
    const cfg = loadConfig();
    const products = (data ?? []).map((p: Record<string, unknown>) => ({ ...p, thumbnailUrl: productImageUrl(cfg.SUPABASE_URL, (p.images as string[] | null)?.[0]) }));
    return reply.send({ products });
  });
}
