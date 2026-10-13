// P5 (FR-P5.4): deleting a product hides it rather than removing the row, because order_items
// reference it. Own route file with its own auth hook (Part 0.3); the other product routes
// predate that rule and stay in routes/admin.ts.
import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  app.delete('/api/v1/admin/products/:id', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const { id } = req.params as { id: string };
    const { data } = await db.from('products').update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', id).eq('merchant_id', req.merchantCtx!.merchantId).is('deleted_at', null).select('id').maybeSingle();
    if (!data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'product not found' } });
    return reply.send({ ok: true });
  });
}
