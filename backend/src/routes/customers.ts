// P5 (FR-P5.8): block / unblock a customer. A blocked customer's messages are stored and never
// answered, like an opt-out. Managers only; own route file with its own auth hook (Part 0.3).
import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  for (const [path, blocked] of [['block', true], ['unblock', false]] as const) {
    app.post(`/api/v1/admin/customers/:id/${path}`, async (req, reply) => {
      if (!isManager(req.merchantCtx!)) return forbid(reply);
      const { id } = req.params as { id: string };
      const { data } = await db.from('customers').update({ is_blocked: blocked }).eq('id', id).eq('merchant_id', req.merchantCtx!.merchantId).select('id').maybeSingle();
      if (!data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'customer not found' } });
      return reply.send({ ok: true, isBlocked: blocked });
    });
  }
}
