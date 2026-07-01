import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';

/**
 * Health endpoints (docs/spec/09 §5.4, CD-34).
 *  - /healthz : liveness (process is up). Used by Railway restart policy.
 *  - /readyz  : readiness (dependencies reachable). Used to gate traffic.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/readyz', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {};
    let dbError: string | undefined;

    // DB reachability — cheap probe.
    try {
      const { error } = await getServiceClient().from('merchants').select('id').limit(1);
      checks.db = error ? 'fail' : 'ok';
      if (error) dbError = error.message;
    } catch (e) {
      checks.db = 'fail';
      dbError = e instanceof Error ? e.message : String(e);
    }

    const ready = Object.values(checks).every((v) => v === 'ok');
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', checks, ...(dbError ? { dbError } : {}) });
  });
}
