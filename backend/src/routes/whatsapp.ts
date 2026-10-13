import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { ConnectFailure, connectWhatsApp, disconnectWhatsApp, getConnectionStatus, retryConnect, sendTestMessage, syncBusinessProfile } from '../whatsapp/connect';
import { resubmitTemplate } from '../whatsapp/templates';
import { notifyBuyerNow } from '../orchestrator/payment-service';

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

  // FR-M3.3 — also what onboarding step 7 (P2) calls.
  app.post('/api/v1/admin/whatsapp/test', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    try {
      return reply.send(await sendTestMessage(db, req.merchantCtx!));
    } catch (e) {
      if (e instanceof ConnectFailure) { const { status, ...rest } = e.err; return reply.code(status).send({ error: rest }); }
      throw e;
    }
  });

  // FR-M3.4
  app.post('/api/v1/admin/whatsapp/disconnect', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    try {
      return reply.send(await disconnectWhatsApp(db, req.merchantCtx!));
    } catch (e) {
      if (e instanceof ConnectFailure) { const { status, ...rest } = e.err; return reply.code(status).send({ error: rest }); }
      throw e;
    }
  });

  // IC-9 — P2 calls this after the shop profile step saves.
  app.post('/api/v1/admin/whatsapp/profile-sync', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    return reply.send({ synced: await syncBusinessProfile(db, req.merchantCtx!.merchantId) });
  });

  // FR-M4.3 — a rejected template goes back under a new name.
  app.post('/api/v1/admin/whatsapp/templates/:kind/resubmit', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const { kind } = req.params as { kind: string };
    const row = await resubmitTemplate(db, req.merchantCtx!, kind);
    if (!row) return reply.code(400).send({ error: { code: 'BAD', message: 'Unknown template, no connected number, or Meta refused it' } });
    return reply.send({ template: row });
  });

  // FR-M4.6 — the paid buyer notice (the merchant pressed the button that shows the price).
  app.post('/api/v1/admin/orders/:id/notify-buyer', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const { id } = req.params as { id: string };
    const kind = (req.body as { kind?: unknown } | undefined)?.kind;
    if (kind !== 'payment_update' && kind !== 'order_sent') return reply.code(400).send({ error: { code: 'BAD', message: 'kind must be payment_update or order_sent' } });
    const r = await notifyBuyerNow(db, req.merchantCtx!, id, kind);
    if (!r.ok) return reply.code(r.status).send({ error: { code: r.code, message: r.message } });
    return reply.send({ ok: true, waMessageId: r.waMessageId, template: r.template });
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
