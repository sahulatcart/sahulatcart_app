import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { ConnectFailure, connectWhatsApp, getConnectionStatus, retryConnect } from '../whatsapp/connect';

/**
 * /api/v1/admin/whatsapp/* — the merchant's WhatsApp connection (SRS-Fazal M2, M3).
 * Its own route file with its own auth hook (SRS Part 0.3); nothing is appended to admin.ts.
 */
export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  // IC-4 — the status the portal and onboarding read.
  app.get('/api/v1/admin/whatsapp', async (req, reply) => {
    return reply.send(await getConnectionStatus(db, req.merchantCtx!.merchantId));
  });

  app.get('/api/v1/admin/whatsapp/attempts', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const { data } = await db
      .from('whatsapp_connect_attempts')
      .select('id, status, waba_id, phone_number_id, error_code, error_message, created_at, updated_at')
      .eq('merchant_id', req.merchantCtx!.merchantId)
      .order('created_at', { ascending: false })
      .limit(10);
    return reply.send({ attempts: data ?? [] });
  });

  app.post('/api/v1/admin/whatsapp/connect', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const b = (req.body ?? {}) as { code?: unknown; hints?: { wabaId?: unknown; phoneNumberId?: unknown }; phoneNumberId?: unknown };
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    try {
      const status = await connectWhatsApp(db, req.merchantCtx!, {
        code: str(b.code) ?? '',
        hints: { wabaId: str(b.hints?.wabaId), phoneNumberId: str(b.hints?.phoneNumberId) },
        phoneNumberId: str(b.phoneNumberId),
      });
      return reply.send(status);
    } catch (e) {
      if (e instanceof ConnectFailure) {
        const { status, ...rest } = e.err;
        return reply.code(status).send({ error: rest });
      }
      throw e;
    }
  });

  app.post('/api/v1/admin/whatsapp/retry', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const pin = (req.body as { pin?: unknown } | undefined)?.pin;
    try {
      return reply.send(await retryConnect(db, req.merchantCtx!, typeof pin === 'string' ? pin.trim() : undefined));
    } catch (e) {
      if (e instanceof ConnectFailure) {
        const { status, ...rest } = e.err;
        return reply.code(status).send({ error: rest });
      }
      throw e;
    }
  });
}
