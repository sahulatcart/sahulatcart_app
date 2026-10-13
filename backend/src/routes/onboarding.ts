// Onboarding with readiness gates (SRS P2): the readiness endpoint and delivery-zone editing.
// Its own route file with its own auth hook (Part 0.3); nothing here goes into routes/admin.ts.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { computeReadiness } from '../lib/readiness';
import { IMAGE_TYPES, invalidProfileField, invalidZoneField } from '../lib/validation';
import { validBusinessHours } from '../lib/hours';
import { isPakistaniMobile, phoneDigits } from '../lib/phone';
import { MAX_IMAGE_BYTES, productImageUrl } from '../lib/images';
import { syncBusinessProfile } from '../whatsapp/connect';

const ZONE_COLS = 'id, area_name, city, charge, is_serviceable, eta_text';
const ZONE_FIELDS = ['area_name', 'city', 'charge', 'is_serviceable', 'eta_text'] as const;

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  // FR-P2.1 — the seven checks, computed from the data every time it is asked.
  app.get('/api/v1/admin/readiness', async (req, reply) => {
    return reply.send(await computeReadiness(db, req.merchantCtx!.merchantId));
  });

  // ── Delivery zones (FR-P2.3 step 4). The bot matches area_name by whole words (delivery.ts). ──
  app.get('/api/v1/admin/delivery-zones', async (req, reply) => {
    const r = await db.from('delivery_zones').select(ZONE_COLS).eq('merchant_id', req.merchantCtx!.merchantId).order('area_name');
    return reply.send({ zones: r.data ?? [] });
  });

  /** The same area twice (any case) would make the bot's match arbitrary. */
  async function duplicateArea(mid: string, areaName: string, exceptId?: string): Promise<boolean> {
    const r = await db.from('delivery_zones').select('id, area_name').eq('merchant_id', mid);
    const want = areaName.trim().toLowerCase();
    return (r.data ?? []).some((z) => z.id !== exceptId && String(z.area_name).trim().toLowerCase() === want);
  }

  const pick = (b: Record<string, unknown>): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    for (const k of ZONE_FIELDS) if (k in b) row[k] = typeof b[k] === 'string' ? (b[k] as string).trim() : b[k];
    if (row.city === '') row.city = null;
    if (row.eta_text === '') row.eta_text = null;
    return row;
  };

  app.post('/api/v1/admin/delivery-zones', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bad = invalidZoneField(b) ?? (typeof b.area_name === 'string' ? null : 'area_name') ?? (Number.isInteger(b.charge) ? null : 'charge');
    if (bad) return reply.code(400).send({ error: { code: 'BAD', message: `${bad} is missing or invalid` } });
    if (await duplicateArea(mid, b.area_name as string)) return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'That area is already in the list' } });
    const row = { merchant_id: mid, is_serviceable: true, ...pick(b) };
    const { data, error } = await db.from('delivery_zones').insert(row).select(ZONE_COLS).single();
    if (error?.code === '23505') return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'That area is already in the list' } }); // the index (0018) caught a race
    if (error || !data) return reply.code(400).send({ error: { code: 'DB', message: error?.message ?? 'could not save' } });
    return reply.send({ zone: data });
  });

  app.patch('/api/v1/admin/delivery-zones/:id', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const cur = await db.from('delivery_zones').select('id').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!cur.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'delivery zone not found' } });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bad = invalidZoneField(b);
    if (bad) return reply.code(400).send({ error: { code: 'BAD', message: `${bad} is missing or invalid` } });
    if (typeof b.area_name === 'string' && (await duplicateArea(mid, b.area_name, id))) {
      return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'That area is already in the list' } });
    }
    const patch = pick(b);
    if (!Object.keys(patch).length) return reply.code(400).send({ error: { code: 'BAD', message: 'nothing to change' } });
    const { data, error } = await db.from('delivery_zones').update(patch).eq('id', id).eq('merchant_id', mid).select(ZONE_COLS).single();
    if (error?.code === '23505') return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'That area is already in the list' } });
    if (error || !data) return reply.code(400).send({ error: { code: 'DB', message: error?.message ?? 'could not save' } });
    return reply.send({ zone: data });
  });

  app.delete('/api/v1/admin/delivery-zones/:id', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const cur = await db.from('delivery_zones').select('id').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!cur.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'delivery zone not found' } });
    const { error } = await db.from('delivery_zones').delete().eq('id', id).eq('merchant_id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ ok: true });
  });

  // ── Shop profile (FR-P2.3 step 1): name, owner, phone, address, category, hours. ──
  // Only the fields sent are written; the phone is stored digits-only (Part 0.3). After a save the
  // WhatsApp business profile is synced best-effort (IC-9) — a no-op until a number is connected.
  app.patch('/api/v1/admin/profile', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!Object.keys(b).length) return reply.code(400).send({ error: { code: 'BAD', message: 'nothing to change' } });
    const bad = invalidProfileField(b);
    if (bad) return reply.code(400).send({ error: { code: 'BAD', message: `${bad} is missing or invalid` } });
    if ('businessHours' in b && !validBusinessHours(b.businessHours)) return reply.code(400).send({ error: { code: 'BAD', message: 'businessHours is invalid: { mon: { open: "10:00", close: "22:00" } | { closed: true }, … }' } });
    const patch: Record<string, unknown> = {};
    if (typeof b.businessName === 'string') patch.business_name = b.businessName.trim();
    if (typeof b.ownerName === 'string') patch.owner_name = b.ownerName.trim();
    if ('address' in b) patch.address = typeof b.address === 'string' && b.address.trim() ? b.address.trim() : null;
    if (typeof b.category === 'string') patch.category = b.category;
    if ('businessHours' in b) patch.business_hours = b.businessHours;
    if ('phone' in b) {
      const digits = phoneDigits(b.phone);
      if (!isPakistaniMobile(digits)) return reply.code(400).send({ error: { code: 'BAD', message: 'phone must be a Pakistani mobile number (+92 3xx xxxxxxx)' } });
      patch.phone = digits;
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from('merchants').update(patch).eq('id', mid);
      if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
      void syncBusinessProfile(db, mid).catch((e: unknown) => logger.warn({ err: (e as Error).message, merchantId: mid }, 'profile sync after save failed'));
    }
    return reply.send({ ok: true, readiness: await computeReadiness(db, mid) });
  });

  // ── Shop logo (FR-P2.3 step 1): same shape as the product image upload; one key per shop. ──
  app.post('/api/v1/admin/settings/logo', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const b = (req.body ?? {}) as { dataBase64?: string; contentType?: string };
    const ext = b.contentType ? IMAGE_TYPES[b.contentType] : undefined;
    if (!b.dataBase64 || !ext) return reply.code(400).send({ error: { code: 'BAD', message: 'dataBase64 and a png, jpeg or webp contentType required' } });
    const buf = Buffer.from(b.dataBase64, 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return reply.code(400).send({ error: { code: 'TOO_BIG', message: 'image over 5MB' } });
    // A new key each time, so a cached old logo never shows after a change; the old file is removed (review P2-5).
    const key = `merchants/${mid}/logo-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const cfg = loadConfig();
    const up = await db.storage.from(cfg.STORAGE_BUCKET_PRODUCT_IMAGES).upload(key, buf, { contentType: b.contentType, upsert: true });
    if (up.error) return reply.code(500).send({ error: { code: 'STORAGE', message: up.error.message } });
    const logoUrl = productImageUrl(cfg.SUPABASE_URL, key);
    const prev = await db.from('merchants').select('logo_url').eq('id', mid).maybeSingle();
    const { error } = await db.from('merchants').update({ logo_url: logoUrl }).eq('id', mid);
    if (error) return reply.code(400).send({ error: { code: 'DB', message: error.message } });
    const oldKey = typeof prev.data?.logo_url === 'string' ? prev.data.logo_url.split('/object/public/product-images/')[1] : undefined;
    if (oldKey && oldKey !== key) await db.storage.from(cfg.STORAGE_BUCKET_PRODUCT_IMAGES).remove([oldKey]).catch(() => undefined);
    return reply.send({ logoUrl });
  });
}
