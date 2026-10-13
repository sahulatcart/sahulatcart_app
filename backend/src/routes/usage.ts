import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { requireMerchant } from '../lib/auth';
import { getUsage } from '../lib/usage';

/** /api/v1/admin/usage — the shop's message meter and AI budget (SRS-Fazal M5, IC-6 for billing). */
export async function usageRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  app.get('/api/v1/admin/usage', async (req, reply) => {
    return reply.send(await getUsage(db, req.merchantCtx!.merchantId));
  });
}
