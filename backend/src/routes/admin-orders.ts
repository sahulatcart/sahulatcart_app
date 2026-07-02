import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { markCodCollected, rejectPayment, verifyPayment } from '../orchestrator/payment-service';
import { signedScreenshotUrl } from '../whatsapp/media';

/**
 * TEMPORARY pilot merchant-action API (docs/spec/03). Gated by ADMIN_API_TOKEN header
 * until the Phase-5 admin portal + Supabase JWT lands. Provides just enough for a
 * merchant to verify/reject bank payments and see pending orders.
 */
function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const cfg = loadConfig();
  if (!cfg.ADMIN_API_TOKEN || req.headers['x-admin-token'] !== cfg.ADMIN_API_TOKEN) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'admin token required' } });
    return false;
  }
  return true;
}

export async function adminOrderRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();

  // List orders needing merchant attention (claimed bank payments, recent orders).
  app.get('/api/v1/admin/orders', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = (req.query as { status?: string }).status;
    let q = db.from('orders').select('id, order_number, status, payment_method, payment_status, total, delivery_name, created_at').order('created_at', { ascending: false }).limit(50);
    if (status) q = q.eq('payment_status', status);
    const { data, error } = await q;
    if (error) return reply.code(500).send({ error: { code: 'DB', message: error.message } });
    return reply.send({ orders: data });
  });

  // Signed URL to view the payment screenshot (short-lived, on-demand — CD-40).
  app.get('/api/v1/admin/orders/:id/screenshot', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const pay = await db.from('payments').select('screenshot_url').eq('order_id', id).maybeSingle();
    const key = pay.data?.screenshot_url;
    if (!key) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no screenshot' } });
    const url = await signedScreenshotUrl(db, key);
    return reply.send({ url });
  });

  app.post('/api/v1/admin/orders/:id/payment/verify', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const r = await verifyPayment(db, id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/v1/admin/orders/:id/payment/reject', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const reason = (req.body as { reason?: string })?.reason ?? 'not verified';
    const r = await rejectPayment(db, id, reason);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/v1/admin/orders/:id/payment/cod-collected', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const r = await markCodCollected(db, id);
    return reply.code(r.ok ? 200 : 400).send(r);
  });
}
