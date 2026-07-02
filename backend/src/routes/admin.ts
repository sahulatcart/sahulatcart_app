import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { markCodCollected, rejectPayment, verifyPayment } from '../orchestrator/payment-service';
import { signedScreenshotUrl } from '../whatsapp/media';
import { sendText } from '../whatsapp/client';

/**
 * Merchant admin API for the Phase-5 portal. Pilot: single merchant, gated by a
 * bearer/x-admin-token (== ADMIN_API_TOKEN). Multi-tenant Supabase-JWT auth is the scale path.
 */
function tokenOf(req: FastifyRequest): string | undefined {
  const h = req.headers['x-admin-token'];
  if (typeof h === 'string') return h;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}
function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const cfg = loadConfig();
  if (!cfg.ADMIN_API_TOKEN || tokenOf(req) !== cfg.ADMIN_API_TOKEN) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } });
    return false;
  }
  return true;
}

let merchantIdCache: string | undefined;
async function merchantId(db: SupabaseClient): Promise<string | undefined> {
  if (merchantIdCache) return merchantIdCache;
  const cfg = loadConfig();
  if (cfg.META_DEFAULT_PHONE_NUMBER_ID) {
    const r = await db.from('whatsapp_numbers').select('merchant_id').eq('phone_number_id', cfg.META_DEFAULT_PHONE_NUMBER_ID).maybeSingle();
    merchantIdCache = r.data?.merchant_id;
  }
  if (!merchantIdCache) {
    const m = await db.from('merchants').select('id').limit(1).maybeSingle();
    merchantIdCache = m.data?.id;
  }
  return merchantIdCache;
}

const startOfTodayUtc = (): string => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();

  // ── Auth ──
  app.post('/api/v1/admin/login', async (req, reply) => {
    const cfg = loadConfig();
    const pw = (req.body as { password?: string })?.password;
    if (!cfg.ADMIN_API_TOKEN || pw !== cfg.ADMIN_API_TOKEN) {
      return reply.code(401).send({ error: { code: 'BAD_LOGIN', message: 'galat password' } });
    }
    return reply.send({ token: cfg.ADMIN_API_TOKEN });
  });

  app.get('/api/v1/admin/me', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const m = await db.from('merchants').select('id, business_name, settings, negotiation_defaults').eq('id', mid).maybeSingle();
    return reply.send({ merchant: m.data });
  });

  // ── Dashboard ──
  app.get('/api/v1/admin/dashboard', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const since = startOfTodayUtc();
    const [ordersToday, pending, recent, activeChats] = await Promise.all([
      db.from('orders').select('total', { count: 'exact' }).eq('merchant_id', mid).gte('created_at', since).not('order_number', 'is', null),
      db.from('orders').select('id', { count: 'exact', head: true }).eq('merchant_id', mid).eq('payment_status', 'claimed'),
      db.from('orders').select('id, order_number, status, payment_method, payment_status, total, delivery_name, created_at').eq('merchant_id', mid).not('order_number', 'is', null).order('created_at', { ascending: false }).limit(10),
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('merchant_id', mid).eq('status', 'bot_active'),
    ]);
    const revenueToday = (ordersToday.data ?? []).reduce((s, o) => s + (o.total ?? 0), 0);
    return reply.send({
      ordersToday: ordersToday.count ?? 0,
      revenueToday,
      pendingPayments: pending.count ?? 0,
      activeChats: activeChats.count ?? 0,
      recentOrders: recent.data ?? [],
    });
  });

  // ── Orders ──
  app.get('/api/v1/admin/orders', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const { status, payment } = req.query as { status?: string; payment?: string };
    let q = db.from('orders').select('id, order_number, status, payment_method, payment_status, total, delivery_name, delivery_area, created_at').eq('merchant_id', mid).order('created_at', { ascending: false }).limit(100);
    if (status) q = q.eq('status', status);
    if (payment) q = q.eq('payment_status', payment);
    const { data, error } = await q;
    if (error) return reply.code(500).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ orders: data });
  });

  app.get('/api/v1/admin/orders/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const order = await db.from('orders').select('*').eq('id', id).maybeSingle();
    if (!order.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'order not found' } });
    const items = await db.from('order_items').select('name_snapshot, quantity, unit_price, discount, line_total').eq('order_id', id);
    const payment = await db.from('payments').select('method, amount, status, screenshot_url, claimed_at, verified_at').eq('order_id', id).maybeSingle();
    const claims = await db.from('payment_claims').select('status, amount, rejection_reason, claimed_at').eq('order_id', id).order('created_at', { ascending: false });
    return reply.send({ order: order.data, items: items.data ?? [], payment: payment.data, claims: claims.data ?? [] });
  });

  app.get('/api/v1/admin/orders/:id/screenshot', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const pay = await db.from('payments').select('screenshot_url').eq('order_id', id).maybeSingle();
    const key = pay.data?.screenshot_url;
    if (!key || key.startsWith('media:')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no stored screenshot' } });
    return reply.send({ url: await signedScreenshotUrl(db, key) });
  });

  app.post('/api/v1/admin/orders/:id/payment/verify', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const r = await verifyPayment(db, (req.params as { id: string }).id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });
  app.post('/api/v1/admin/orders/:id/payment/reject', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const reason = (req.body as { reason?: string })?.reason ?? 'not verified';
    const r = await rejectPayment(db, (req.params as { id: string }).id, reason);
    return reply.code(r.ok ? 200 : 400).send(r);
  });
  app.post('/api/v1/admin/orders/:id/payment/cod-collected', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const r = await markCodCollected(db, (req.params as { id: string }).id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // ── Inbox / Conversations ──
  app.get('/api/v1/admin/conversations', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const { data } = await db
      .from('conversations')
      .select('id, status, current_state, last_message_at, unread_count, customers(name, wa_id)')
      .eq('merchant_id', mid)
      .neq('status', 'closed')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(50);
    return reply.send({ conversations: data ?? [] });
  });

  app.get('/api/v1/admin/conversations/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const convo = await db.from('conversations').select('id, status, current_state, customers(name, wa_id)').eq('id', id).maybeSingle();
    if (!convo.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'conversation not found' } });
    const messages = await db.from('messages').select('direction, sender, type, body, status, created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(200);
    await db.from('conversations').update({ unread_count: 0 }).eq('id', id); // opening = read
    return reply.send({ conversation: convo.data, messages: messages.data ?? [] });
  });

  app.post('/api/v1/admin/conversations/:id/takeover', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const c = await db.from('conversations').select('current_state, context').eq('id', id).single();
    const context = (c.data?.context ?? {}) as Record<string, unknown>;
    if (c.data?.current_state !== 'handoff') context.resume_state = c.data?.current_state;
    await db.from('conversations').update({ status: 'human_takeover', current_state: 'handoff', context }).eq('id', id);
    return reply.send({ ok: true });
  });

  app.post('/api/v1/admin/conversations/:id/release', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const c = await db.from('conversations').select('context').eq('id', id).single();
    const context = (c.data?.context ?? {}) as Record<string, unknown>;
    const resume = (context.resume_state as string) ?? 'greeting';
    delete context.resume_state;
    await db.from('conversations').update({ status: 'bot_active', current_state: resume, context }).eq('id', id);
    return reply.send({ ok: true });
  });

  app.post('/api/v1/admin/conversations/:id/send', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const text = (req.body as { text?: string })?.text?.trim();
    if (!text) return reply.code(400).send({ error: { code: 'BAD', message: 'text required' } });
    const mid = await merchantId(db);
    const convo = await db.from('conversations').select('whatsapp_number_id, customers(wa_id)').eq('id', id).single();
    const waId = (convo.data?.customers as { wa_id?: string } | null)?.wa_id;
    const num = convo.data?.whatsapp_number_id
      ? await db.from('whatsapp_numbers').select('phone_number_id').eq('id', convo.data.whatsapp_number_id).single()
      : { data: null };
    const phoneNumberId = num.data?.phone_number_id ?? (await db.from('whatsapp_numbers').select('phone_number_id').eq('merchant_id', mid).limit(1).maybeSingle()).data?.phone_number_id;
    if (!waId || !phoneNumberId) return reply.code(400).send({ error: { code: 'NO_CHANNEL', message: 'cannot reach customer' } });
    const sent = await sendText(phoneNumberId, waId, text);
    await db.from('messages').insert({ conversation_id: id, merchant_id: mid, direction: 'outbound', sender: 'agent', type: 'text', body: text, wa_message_id: sent.waMessageId, status: sent.waMessageId ? 'sent' : 'queued' });
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', id);
    return reply.send({ ok: true, delivered: !!sent.waMessageId });
  });

  // ── Analytics ──
  app.get('/api/v1/admin/analytics', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const [placed, negotiations] = await Promise.all([
      db.from('orders').select('status, payment_method, payment_status, total, discount_total, subtotal, created_at').eq('merchant_id', mid).not('order_number', 'is', null),
      db.from('negotiations').select('status, list_price, agreed_price').eq('merchant_id', mid),
    ]);
    const orders = placed.data ?? [];
    const negs = negotiations.data ?? [];
    const collected = orders.filter((o) => o.payment_status === 'verified' || o.payment_status === 'cod_collected').reduce((s, o) => s + o.total, 0);
    const gross = orders.reduce((s, o) => s + o.total, 0);
    const agreed = negs.filter((n) => n.status === 'agreed');
    const avgDiscountPct = agreed.length ? Math.round((agreed.reduce((s, n) => s + (n.list_price ? (1 - (n.agreed_price ?? n.list_price) / n.list_price) : 0), 0) / agreed.length) * 1000) / 10 : 0;
    const done = negs.filter((n) => n.status === 'agreed' || n.status === 'rejected');
    return reply.send({
      totalOrders: orders.length,
      grossRevenue: gross,
      collectedRevenue: collected,
      returnCancelRate: orders.length ? Math.round((orders.filter((o) => ['cancelled', 'returned'].includes(o.status)).length / orders.length) * 1000) / 10 : 0,
      codVsBank: { cod: orders.filter((o) => o.payment_method === 'cod').length, bank: orders.filter((o) => o.payment_method === 'bank_transfer').length },
      negotiationWinRate: done.length ? Math.round((agreed.length / done.length) * 1000) / 10 : 0,
      avgDiscountPct,
      negotiationsAgreed: agreed.length,
    });
  });

  // ── Catalog ──
  app.get('/api/v1/admin/products', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const { data } = await db.from('products').select('id, sku, name, description, price, cost, stock, track_stock, is_active, negotiable, max_discount_pct, min_price').eq('merchant_id', mid).order('created_at', { ascending: true });
    return reply.send({ products: data ?? [] });
  });

  app.post('/api/v1/admin/products', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const b = req.body as Record<string, unknown>;
    const { data, error } = await db.from('products').insert({ merchant_id: mid, name: b.name, description: b.description ?? null, price: b.price ?? 0, cost: b.cost ?? null, stock: b.stock ?? null, track_stock: b.track_stock ?? false, is_active: b.is_active ?? true, negotiable: b.negotiable ?? false, max_discount_pct: b.max_discount_pct ?? null, min_price: b.min_price ?? null, sku: b.sku ?? null }).select('id').single();
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ id: data.id });
  });

  app.patch('/api/v1/admin/products/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const { id } = req.params as { id: string };
    const b = req.body as Record<string, unknown>;
    const allowed = ['name', 'description', 'price', 'cost', 'stock', 'track_stock', 'is_active', 'negotiable', 'max_discount_pct', 'min_price', 'sku'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in b) patch[k] = b[k];
    const { error } = await db.from('products').update(patch).eq('id', id).eq('merchant_id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ok: true });
  });

  // ── Settings (merchant negotiation_defaults + settings jsonb) ──
  app.get('/api/v1/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const m = await db.from('merchants').select('business_name, negotiation_defaults, settings, bot_persona').eq('id', mid).single();
    const banks = await db.from('bank_accounts').select('id, bank_name, account_title, account_number, iban, is_default, is_active').eq('merchant_id', mid);
    const zones = await db.from('delivery_zones').select('id, area_name, city, charge, is_serviceable').eq('merchant_id', mid);
    return reply.send({ ...m.data, bankAccounts: banks.data ?? [], deliveryZones: zones.data ?? [] });
  });

  app.patch('/api/v1/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const b = req.body as { negotiationDefaults?: Record<string, unknown>; settings?: Record<string, unknown>; botPersona?: Record<string, unknown> };
    const cur = await db.from('merchants').select('negotiation_defaults, settings, bot_persona').eq('id', mid).single();
    const patch: Record<string, unknown> = {};
    if (b.negotiationDefaults) patch.negotiation_defaults = { ...(cur.data?.negotiation_defaults ?? {}), ...b.negotiationDefaults };
    if (b.settings) patch.settings = { ...(cur.data?.settings ?? {}), ...b.settings };
    if (b.botPersona) patch.bot_persona = { ...(cur.data?.bot_persona ?? {}), ...b.botPersona };
    const { error } = await db.from('merchants').update(patch).eq('id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ok: true });
  });

  // ── Bank accounts ──
  app.post('/api/v1/admin/bank-accounts', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    const b = req.body as Record<string, unknown>;
    const { data, error } = await db.from('bank_accounts').insert({ merchant_id: mid, bank_name: b.bank_name, account_title: b.account_title, account_number: b.account_number, iban: b.iban ?? null, is_default: b.is_default ?? false, is_active: true }).select('id').single();
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ id: data.id });
  });
  app.delete('/api/v1/admin/bank-accounts/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const mid = await merchantId(db);
    await db.from('bank_accounts').delete().eq('id', (req.params as { id: string }).id).eq('merchant_id', mid);
    return reply.send({ ok: true });
  });
}
