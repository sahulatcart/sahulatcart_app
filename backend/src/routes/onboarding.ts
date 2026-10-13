// Onboarding with readiness gates (SRS P2): the readiness endpoint and delivery-zone editing.
// Its own route file with its own auth hook (Part 0.3); nothing here goes into routes/admin.ts.
import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { computeReadiness } from '../lib/readiness';
import { invalidZoneField } from '../lib/validation';

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
    const { data, error } = await db.from('delivery_zones').update(pick(b)).eq('id', id).eq('merchant_id', mid).select(ZONE_COLS).single();
    if (error || !data) return reply.code(400).send({ error: { code: 'DB', message: error?.message ?? 'could not save' } });
    return reply.send({ zone: data });
  });

  app.delete('/api/v1/admin/delivery-zones/:id', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const mid = req.merchantCtx!.merchantId;
    const { id } = req.params as { id: string };
    const cur = await db.from('delivery_zones').select('id').eq('id', id).eq('merchant_id', mid).maybeSingle();
    if (!cur.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'delivery zone not found' } });
    await db.from('delivery_zones').delete().eq('id', id).eq('merchant_id', mid);
    return reply.send({ ok: true });
  });
}
