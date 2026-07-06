import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { canManagePayments, forbid, resolveCtx } from '../lib/auth';
import { markCodCollected, rejectPayment, verifyPayment } from '../orchestrator/payment-service';
import { signedScreenshotUrl } from '../whatsapp/media';
import { sendText } from '../whatsapp/client';
import { parseCsv } from '../lib/csv';
import { productImageUrl } from '../lib/images';
import { getLlmClient } from '../llm';
import { isShopifyCsv, mapShopifyRows } from '../lib/shopify';

const PUBLIC = new Set(['/api/v1/admin/login', '/api/v1/config']);

const startOfTodayUtc = (): string => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};

// Ownership guards — a by-id resource must belong to the caller's merchant (tenant isolation).
async function orderMerchant(db: SupabaseClient, id: string): Promise<string | undefined> {
  const r = await db.from('orders').select('merchant_id').eq('id', id).maybeSingle();
  return r.data?.merchant_id as string | undefined;
}
async function convoMerchant(db: SupabaseClient, id: string): Promise<string | undefined> {
  const r = await db.from('conversations').select('merchant_id').eq('id', id).maybeSingle();
  return r.data?.merchant_id as string | undefined;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();

  // ── Auth gate for every admin route except the public ones ──
  app.addHook('preHandler', async (req, reply) => {
    if (PUBLIC.has(req.routeOptions?.url ?? '')) return;
    const ctx = await resolveCtx(req);
    if (!ctx) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } });
    req.merchantCtx = ctx;
  });

  // ── Public runtime config (Supabase URL + publishable anon key — not secret) ──
  app.get('/api/v1/config', async (_req, reply) => {
    const cfg = loadConfig();
    return reply.send({ supabaseUrl: cfg.SUPABASE_URL, supabaseAnonKey: cfg.SUPABASE_ANON_KEY });
  });

  // ── Auth (token fallback path; email/password login happens client-side via Supabase) ──
  app.post('/api/v1/admin/login', async (req, reply) => {
    const cfg = loadConfig();
    const pw = (req.body as { password?: string })?.password;
    if (!cfg.ADMIN_API_TOKEN || pw !== cfg.ADMIN_API_TOKEN) {
      return reply.code(401).send({ error: { code: 'BAD_LOGIN', message: 'galat password' } });
    }
    return reply.send({ token: cfg.ADMIN_API_TOKEN });
  });

  app.get('/api/v1/admin/me', async (req, reply) => {
    const { merchantId: mid, role, isPlatformAdmin } = req.merchantCtx!;
    const m = await db.from('merchants').select('id, business_name, settings, negotiation_defaults').eq('id', mid).maybeSingle();
    return reply.send({ merchant: m.data, role, isPlatformAdmin });
  });

  // ── Platform-admin: create a merchant + owner user (invite-only) ──
  app.post('/api/v1/admin/merchants', async (req, reply) => {
    if (!req.merchantCtx!.isPlatformAdmin) return forbid(reply);
    const b = req.body as { businessName?: string; ownerEmail?: string; ownerPassword?: string; ownerName?: string };
    if (!b.businessName || !b.ownerEmail || !b.ownerPassword) return reply.code(400).send({ error: { code: 'BAD', message: 'businessName, ownerEmail, ownerPassword required' } });
    const created = await db.auth.admin.createUser({ email: b.ownerEmail, password: b.ownerPassword, email_confirm: true });
    if (created.error || !created.data.user) return reply.code(400).send({ error: { code: 'AUTH', message: created.error?.message ?? 'could not create user' } });
    const m = await db.from('merchants').insert({ business_name: b.businessName, owner_name: b.ownerName ?? null, email: b.ownerEmail, status: 'active' }).select('id').single();
    if (m.error || !m.data) { await db.auth.admin.deleteUser(created.data.user.id); return reply.code(400).send({ error: { code: 'DB', message: m.error?.message } }); }
    await db.from('merchant_users').insert({ merchant_id: m.data.id, auth_user_id: created.data.user.id, email: b.ownerEmail, name: b.ownerName ?? null, role: 'owner', is_active: true });
    return reply.send({ merchantId: m.data.id, userId: created.data.user.id });
  });

  // ── Dashboard ──
  app.get('/api/v1/admin/dashboard', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const since = startOfTodayUtc();
    const [ordersToday, pending, recent, activeChats] = await Promise.all([
      db.from('orders').select('total', { count: 'exact' }).eq('merchant_id', mid).gte('created_at', since).not('order_number', 'is', null),
      db.from('orders').select('id', { count: 'exact', head: true }).eq('merchant_id', mid).eq('payment_status', 'claimed'),
      db.from('orders').select('id, order_number, status, payment_method, payment_status, total, delivery_name, created_at').eq('merchant_id', mid).not('order_number', 'is', null).order('created_at', { ascending: false }).limit(10),
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('merchant_id', mid).eq('status', 'bot_active'),
    ]);
    return reply.send({
      ordersToday: ordersToday.count ?? 0,
      revenueToday: (ordersToday.data ?? []).reduce((s, o) => s + (o.total ?? 0), 0),
      pendingPayments: pending.count ?? 0,
      activeChats: activeChats.count ?? 0,
      recentOrders: recent.data ?? [],
    });
  });

  // ── Orders ──
  app.get('/api/v1/admin/orders', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { status, payment } = req.query as { status?: string; payment?: string };
    let q = db.from('orders').select('id, order_number, status, payment_method, payment_status, total, delivery_name, delivery_area, created_at').eq('merchant_id', mid).order('created_at', { ascending: false }).limit(100);
    if (status) q = q.eq('status', status);
    if (payment) q = q.eq('payment_status', payment);
    const { data, error } = await q;
    if (error) return reply.code(500).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ orders: data });
  });

  app.get('/api/v1/admin/orders/:id', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const order = await db.from('orders').select('*').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!order.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'order not found' } });
    const items = await db.from('order_items').select('name_snapshot, quantity, unit_price, discount, line_total').eq('order_id', id);
    const payment = await db.from('payments').select('method, amount, status, screenshot_url, claimed_at, verified_at').eq('order_id', id).maybeSingle();
    const claims = await db.from('payment_claims').select('status, amount, rejection_reason, claimed_at').eq('order_id', id).order('created_at', { ascending: false });
    return reply.send({ order: order.data, items: items.data ?? [], payment: payment.data, claims: claims.data ?? [] });
  });

  app.get('/api/v1/admin/orders/:id/screenshot', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const pay = await db.from('payments').select('screenshot_url').eq('order_id', id).eq('merchant_id', mid).maybeSingle();
    const key = pay.data?.screenshot_url;
    if (!key || key.startsWith('media:')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no stored screenshot' } });
    return reply.send({ url: await signedScreenshotUrl(db, key) });
  });

  app.post('/api/v1/admin/orders/:id/payment/verify', async (req, reply) => {
    if (!canManagePayments(req.merchantCtx!)) return forbid(reply);
    const { id } = req.params as { id: string };
    if ((await orderMerchant(db, id)) !== req.merchantCtx!.merchantId) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'order not found' } });
    const r = await verifyPayment(db, id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });
  app.post('/api/v1/admin/orders/:id/payment/reject', async (req, reply) => {
    if (!canManagePayments(req.merchantCtx!)) return forbid(reply);
    const { id } = req.params as { id: string };
    if ((await orderMerchant(db, id)) !== req.merchantCtx!.merchantId) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'order not found' } });
    const r = await rejectPayment(db, id, (req.body as { reason?: string })?.reason ?? 'not verified');
    return reply.code(r.ok ? 200 : 400).send(r);
  });
  app.post('/api/v1/admin/orders/:id/payment/cod-collected', async (req, reply) => {
    const { id } = req.params as { id: string };
    if ((await orderMerchant(db, id)) !== req.merchantCtx!.merchantId) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'order not found' } });
    const r = await markCodCollected(db, id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  // ── Inbox / Conversations ──
  app.get('/api/v1/admin/conversations', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { data } = await db.from('conversations').select('id, status, current_state, last_message_at, unread_count, customers(name, wa_id)').eq('merchant_id', mid).neq('status', 'closed').order('last_message_at', { ascending: false, nullsFirst: false }).limit(50);
    return reply.send({ conversations: data ?? [] });
  });

  app.get('/api/v1/admin/conversations/:id', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const convo = await db.from('conversations').select('id, status, current_state, customers(name, wa_id)').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!convo.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'conversation not found' } });
    const messages = await db.from('messages').select('direction, sender, type, body, status, created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(200);
    await db.from('conversations').update({ unread_count: 0 }).eq('id', id);
    return reply.send({ conversation: convo.data, messages: messages.data ?? [] });
  });

  app.post('/api/v1/admin/conversations/:id/takeover', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await db.from('conversations').select('current_state, context, merchant_id').eq('id', id).single();
    if (c.data?.merchant_id !== req.merchantCtx!.merchantId) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    const context = (c.data?.context ?? {}) as Record<string, unknown>;
    if (c.data?.current_state !== 'handoff') context.resume_state = c.data?.current_state;
    await db.from('conversations').update({ status: 'human_takeover', current_state: 'handoff', context }).eq('id', id);
    return reply.send({ ok: true });
  });

  app.post('/api/v1/admin/conversations/:id/release', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await db.from('conversations').select('context, merchant_id').eq('id', id).single();
    if (c.data?.merchant_id !== req.merchantCtx!.merchantId) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    const context = (c.data?.context ?? {}) as Record<string, unknown>;
    const resume = (context.resume_state as string) ?? 'greeting';
    delete context.resume_state;
    await db.from('conversations').update({ status: 'bot_active', current_state: resume, context }).eq('id', id);
    return reply.send({ ok: true });
  });

  app.post('/api/v1/admin/conversations/:id/send', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const text = (req.body as { text?: string })?.text?.trim();
    if (!text) return reply.code(400).send({ error: { code: 'BAD', message: 'text required' } });
    const convo = await db.from('conversations').select('whatsapp_number_id, merchant_id, customers(wa_id)').eq('id', id).single();
    if (convo.data?.merchant_id !== mid) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    const waId = (convo.data?.customers as { wa_id?: string } | null)?.wa_id;
    const num = convo.data?.whatsapp_number_id ? await db.from('whatsapp_numbers').select('phone_number_id').eq('id', convo.data.whatsapp_number_id).single() : { data: null };
    const phoneNumberId = num.data?.phone_number_id ?? (await db.from('whatsapp_numbers').select('phone_number_id').eq('merchant_id', mid).limit(1).maybeSingle()).data?.phone_number_id;
    if (!waId || !phoneNumberId) return reply.code(400).send({ error: { code: 'NO_CHANNEL', message: 'cannot reach customer' } });
    const sent = await sendText(phoneNumberId, waId, text);
    await db.from('messages').insert({ conversation_id: id, merchant_id: mid, direction: 'outbound', sender: 'agent', type: 'text', body: text, wa_message_id: sent.waMessageId, status: sent.waMessageId ? 'sent' : 'queued' });
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', id);
    return reply.send({ ok: true, delivered: !!sent.waMessageId });
  });

  // ── Analytics ──
  app.get('/api/v1/admin/analytics', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const [placed, negotiations] = await Promise.all([
      db.from('orders').select('status, payment_method, payment_status, total, discount_total, subtotal, created_at').eq('merchant_id', mid).not('order_number', 'is', null),
      db.from('negotiations').select('status, list_price, agreed_price').eq('merchant_id', mid),
    ]);
    const orders = placed.data ?? [];
    const negs = negotiations.data ?? [];
    const collected = orders.filter((o) => o.payment_status === 'verified' || o.payment_status === 'cod_collected').reduce((s, o) => s + o.total, 0);
    const agreed = negs.filter((n) => n.status === 'agreed');
    const avgDiscountPct = agreed.length ? Math.round((agreed.reduce((s, n) => s + (n.list_price ? (1 - (n.agreed_price ?? n.list_price) / n.list_price) : 0), 0) / agreed.length) * 1000) / 10 : 0;
    const done = negs.filter((n) => n.status === 'agreed' || n.status === 'rejected');
    return reply.send({
      totalOrders: orders.length,
      grossRevenue: orders.reduce((s, o) => s + o.total, 0),
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
    const mid = req.merchantCtx!.merchantId;
    const cols = canManagePayments(req.merchantCtx!) ? 'id, sku, name, description, price, cost, stock, track_stock, is_active, negotiable, max_discount_pct, min_price, images' : 'id, sku, name, description, price, stock, track_stock, is_active, negotiable, max_discount_pct, min_price, images';
    const { data } = await db.from('products').select(cols as '*').eq('merchant_id', mid).order('created_at', { ascending: true });
    const cfg2 = loadConfig();
    const products = (data ?? []).map((p: Record<string, unknown>) => ({
      ...p,
      thumbnailUrl: productImageUrl(cfg2.SUPABASE_URL, (p.images as string[] | null)?.[0]),
    }));
    return reply.send({ products });
  });

  app.get('/api/v1/admin/products/:id', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const cols = canManagePayments(req.merchantCtx!) ? '*' : 'id, sku, name, description, price, stock, track_stock, is_active, negotiable, max_discount_pct, min_price, images, attributes, created_at';
    const { data } = await db.from('products').select(cols as '*').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'product not found' } });
    const cfg2 = loadConfig();
    const p = data as Record<string, unknown>;
    const imageUrls = ((p.images as string[] | null) ?? []).map((ref) => ({ ref, url: productImageUrl(cfg2.SUPABASE_URL, ref) }));
    return reply.send({ product: p, imageUrls });
  });

  // Upload a product image (base64 JSON — route-level body limit raised for photos).
  app.post('/api/v1/admin/products/:id/images', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const b = req.body as { dataBase64?: string; contentType?: string };
    if (!b.dataBase64 || !b.contentType?.startsWith('image/')) {
      return reply.code(400).send({ error: { code: 'BAD', message: 'dataBase64 and image contentType required' } });
    }
    const prod = await db.from('products').select('id, images').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!prod.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'product not found' } });
    const buf = Buffer.from(b.dataBase64, 'base64');
    if (buf.length > 5 * 1024 * 1024) return reply.code(400).send({ error: { code: 'TOO_BIG', message: 'image over 5MB' } });
    const ext = b.contentType.includes('png') ? 'png' : b.contentType.includes('webp') ? 'webp' : 'jpg';
    const key = `${mid}/${id}/${crypto.randomUUID()}.${ext}`;
    const cfg2 = loadConfig();
    const up = await db.storage.from(cfg2.STORAGE_BUCKET_PRODUCT_IMAGES).upload(key, buf, { contentType: b.contentType, upsert: false });
    if (up.error) return reply.code(500).send({ error: { code: 'STORAGE', message: up.error.message } });
    const images = [...(((prod.data.images as string[] | null) ?? [])), key];
    const { error } = await db.from('products').update({ images }).eq('id', id).eq('merchant_id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ref: key, url: productImageUrl(cfg2.SUPABASE_URL, key), images });
  });

  app.delete('/api/v1/admin/products/:id/images', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const { ref } = req.body as { ref?: string };
    if (!ref) return reply.code(400).send({ error: { code: 'BAD', message: 'ref required' } });
    const prod = await db.from('products').select('id, images').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!prod.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'product not found' } });
    const images = (((prod.data.images as string[] | null) ?? [])).filter((r) => r !== ref);
    await db.from('products').update({ images }).eq('id', id).eq('merchant_id', mid);
    if (!/^https?:\/\//i.test(ref)) {
      const cfg2 = loadConfig();
      await db.storage.from(cfg2.STORAGE_BUCKET_PRODUCT_IMAGES).remove([ref]); // best-effort
    }
    return reply.send({ ok: true, images });
  });

  // Draft a Roman-Urdu description from the product's first photo (Gemini vision).
  app.post('/api/v1/admin/products/:id/describe', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const prod = await db.from('products').select('id, name, images').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!prod.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'product not found' } });
    const cfg2 = loadConfig();
    const url = productImageUrl(cfg2.SUPABASE_URL, (prod.data.images as string[] | null)?.[0]);
    if (!url) return reply.code(400).send({ error: { code: 'NO_IMAGE', message: 'upload a photo first' } });
    try {
      const res = await fetch(url);
      if (!res.ok) return reply.code(502).send({ error: { code: 'FETCH', message: 'could not read image' } });
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get('content-type') ?? 'image/jpeg';
      const description = await getLlmClient().describeImage(buf, mime, prod.data.name as string);
      if (!description) return reply.code(503).send({ error: { code: 'LLM', message: 'AI unavailable — try again' } });
      return reply.send({ description });
    } catch (e) {
      return reply.code(502).send({ error: { code: 'DESCRIBE', message: (e as Error).message } });
    }
  });

  app.post('/api/v1/admin/products', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const b = req.body as Record<string, unknown>;
    const { data, error } = await db.from('products').insert({ merchant_id: mid, name: b.name, description: b.description ?? null, price: b.price ?? 0, cost: b.cost ?? null, stock: b.stock ?? null, track_stock: b.track_stock ?? false, is_active: b.is_active ?? true, negotiable: b.negotiable ?? false, max_discount_pct: b.max_discount_pct ?? null, min_price: b.min_price ?? null, sku: b.sku ?? null }).select('id').single();
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ id: data.id });
  });

  app.patch('/api/v1/admin/products/:id', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const b = req.body as Record<string, unknown>;
    const allowed = ['name', 'description', 'price', 'cost', 'stock', 'track_stock', 'is_active', 'negotiable', 'max_discount_pct', 'min_price', 'sku', 'attributes'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in b) patch[k] = b[k];
    const { error } = await db.from('products').update(patch).eq('id', id).eq('merchant_id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ok: true });
  });

  app.post('/api/v1/admin/products/import', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const csv = (req.body as { csv?: string })?.csv;
    if (!csv) return reply.code(400).send({ error: { code: 'BAD', message: 'csv required' } });
    const rows = parseCsv(csv);

    // Shopify product export? Map variants/images/options and upsert.
    if (isShopifyCsv(rows)) {
      const mapped = mapShopifyRows(rows);
      const errors: string[] = [];
      let imported = 0;
      for (const p of mapped) {
        const row = {
          merchant_id: mid,
          name: p.name,
          description: p.description,
          price: p.price,
          stock: p.stock,
          track_stock: p.stock != null,
          negotiable: false,
          sku: p.sku,
          images: p.images,
          attributes: p.attributes,
          is_active: true,
        };
        const { error } = p.sku
          ? await db.from('products').upsert(row, { onConflict: 'merchant_id,sku' })
          : await db.from('products').insert(row);
        if (error) errors.push(`${p.name}: ${error.message}`);
        else imported++;
      }
      return reply.send({ imported, errors, total: mapped.length, source: 'shopify' });
    }

    const errors: string[] = [];
    let imported = 0;
    const truthy = (v: string) => ['1', 'true', 'yes', 'y', 'haan'].includes((v ?? '').toLowerCase());
    const rupees = (v: string) => (v && !Number.isNaN(Number(v)) ? Math.round(Number(v) * 100) : null);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const name = r.name || r.product || r.title;
      const price = rupees(r.price || '');
      if (!name || price == null) { errors.push(`Row ${i + 2}: name and numeric price required`); continue; }
      const row = { merchant_id: mid, name, description: r.description || null, price, stock: r.stock && !Number.isNaN(Number(r.stock)) ? Math.round(Number(r.stock)) : null, track_stock: !!(r.stock && r.stock.trim()), negotiable: 'negotiable' in r ? truthy(r.negotiable) : false, max_discount_pct: r.max_discount_pct && !Number.isNaN(Number(r.max_discount_pct)) ? Number(r.max_discount_pct) : null, min_price: rupees(r.min_price || ''), sku: r.sku || null, is_active: true };
      const { error } = row.sku ? await db.from('products').upsert(row, { onConflict: 'merchant_id,sku' }) : await db.from('products').insert(row);
      if (error) errors.push(`Row ${i + 2}: ${error.message}`); else imported++;
    }
    return reply.send({ imported, errors, total: rows.length });
  });

  app.post('/api/v1/admin/products/catalog-sync', async (req, reply) => {
    const cfg = loadConfig();
    const mid = req.merchantCtx!.merchantId;
    const token = cfg.META_SYSTEM_USER_TOKEN;
    const wabaRow = await db.from('whatsapp_numbers').select('waba_id').eq('merchant_id', mid).limit(1).maybeSingle();
    const waba = wabaRow.data?.waba_id;
    if (!token || !waba) return reply.code(400).send({ error: { code: 'NO_WABA', message: 'WhatsApp/WABA not connected' } });
    const v = cfg.META_GRAPH_API_VERSION;
    try {
      const cats = (await fetch(`https://graph.facebook.com/${v}/${waba}/product_catalogs?access_token=${token}`).then((r) => r.json())) as { data?: { id: string }[]; error?: { message: string } };
      const catalogId = cats.data?.[0]?.id;
      if (!catalogId) return reply.send({ synced: 0, message: cats.error?.message || 'No Meta catalog connected to this WhatsApp account.' });
      const prods = (await fetch(`https://graph.facebook.com/${v}/${catalogId}/products?fields=retailer_id,name,price,description&limit=200&access_token=${token}`).then((r) => r.json())) as { data?: { retailer_id: string; name: string; price?: string; description?: string }[] };
      let synced = 0;
      for (const p of prods.data ?? []) {
        const num = p.price ? parseInt(String(p.price).replace(/[^0-9]/g, ''), 10) : NaN;
        const { error } = await db.from('products').upsert({ merchant_id: mid, external_ref: p.retailer_id, name: p.name, description: p.description ?? null, price: Number.isFinite(num) ? num * 100 : 0, is_active: true }, { onConflict: 'merchant_id,external_ref' });
        if (!error) synced++;
      }
      const s = (await db.from('merchants').select('settings').eq('id', mid).single()).data?.settings;
      await db.from('merchants').update({ settings: { ...s, metaCatalog: { catalogId, connected: true, lastSyncedAt: new Date().toISOString() } } }).eq('id', mid);
      return reply.send({ synced, catalogId });
    } catch (e) {
      return reply.code(502).send({ error: { code: 'META', message: (e as Error).message } });
    }
  });

  // ── Settings ──
  app.get('/api/v1/admin/settings', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const m = await db.from('merchants').select('business_name, negotiation_defaults, settings, bot_persona').eq('id', mid).single();
    const banks = await db.from('bank_accounts').select('id, bank_name, account_title, account_number, iban, is_default, is_active').eq('merchant_id', mid);
    const zones = await db.from('delivery_zones').select('id, area_name, city, charge, is_serviceable').eq('merchant_id', mid);
    return reply.send({ ...m.data, bankAccounts: banks.data ?? [], deliveryZones: zones.data ?? [] });
  });

  app.patch('/api/v1/admin/settings', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const b = req.body as { businessName?: string; negotiationDefaults?: Record<string, unknown>; settings?: Record<string, unknown>; botPersona?: Record<string, unknown> };
    const cur = await db.from('merchants').select('negotiation_defaults, settings, bot_persona').eq('id', mid).single();
    const patch: Record<string, unknown> = {};
    if (b.businessName) patch.business_name = b.businessName;
    if (b.negotiationDefaults) patch.negotiation_defaults = { ...(cur.data?.negotiation_defaults ?? {}), ...b.negotiationDefaults };
    if (b.settings) patch.settings = { ...(cur.data?.settings ?? {}), ...b.settings };
    if (b.botPersona) patch.bot_persona = { ...(cur.data?.bot_persona ?? {}), ...b.botPersona };
    const { error } = await db.from('merchants').update(patch).eq('id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ok: true });
  });

  // ── Bank accounts (owner/manager only) ──
  app.post('/api/v1/admin/bank-accounts', async (req, reply) => {
    if (!canManagePayments(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const b = req.body as Record<string, unknown>;
    const { data, error } = await db.from('bank_accounts').insert({ merchant_id: mid, bank_name: b.bank_name, account_title: b.account_title, account_number: b.account_number, iban: b.iban ?? null, is_default: b.is_default ?? false, is_active: true }).select('id').single();
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ id: data.id });
  });
  app.delete('/api/v1/admin/bank-accounts/:id', async (req, reply) => {
    if (!canManagePayments(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    await db.from('bank_accounts').delete().eq('id', (req.params as { id: string }).id).eq('merchant_id', mid);
    return reply.send({ ok: true });
  });
}
