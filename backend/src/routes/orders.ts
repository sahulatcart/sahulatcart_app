// Order stages (SRS P4): preparing → dispatched → delivered. Own route file with its own auth hook
// (Part 0.3); the order list, detail and payment actions stay in routes/admin.ts. Staff may set
// stages (docs/spec/09 §2.3); cancelling stays a manager's action there.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { requireMerchant } from '../lib/auth';
import type { ActionResult, Actor } from '../orchestrator/payment-service';
import { markDelivered, markDispatched, markPreparing } from '../orchestrator/order-stages';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  const stage = (act: (a: Actor, id: string, body: Record<string, unknown>) => Promise<ActionResult>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const c = req.merchantCtx!;
      const r = await act({ merchantId: c.merchantId, memberId: c.memberId }, (req.params as { id: string }).id, (req.body ?? {}) as Record<string, unknown>);
      if (r.ok) return reply.send(r);
      return reply.code(r.status).send({ error: { code: r.status === 404 ? 'NOT_FOUND' : 'CONFLICT', message: r.message } });
    };

  app.post('/api/v1/admin/orders/:id/preparing', stage((a, id) => markPreparing(db, a, id)));
  app.post('/api/v1/admin/orders/:id/dispatched', stage((a, id, b) => markDispatched(db, a, id, {
    courier: b.courier as string | undefined,
    trackingRef: b.trackingRef as string | undefined,
    etaText: b.etaText as string | undefined,
  })));
  app.post('/api/v1/admin/orders/:id/delivered', stage((a, id) => markDelivered(db, a, id)));
}
