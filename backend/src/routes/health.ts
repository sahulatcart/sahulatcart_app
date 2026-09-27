import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { loadConfig } from '../config';
import { getLlmClient } from '../llm';

/**
 * Health endpoints (docs/spec/09 §5.4, CD-34).
 *  - /healthz : liveness (process is up). Used by Railway restart policy.
 *  - /readyz  : readiness (dependencies reachable). Used to gate traffic.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/readyz', async (req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {};

    // DB reachability — cheap probe. The error goes to the log, never the public response.
    try {
      const { error } = await getServiceClient().from('merchants').select('id').limit(1);
      checks.db = error ? 'fail' : 'ok';
      if (error) req.log.error({ err: error.message }, 'readyz: db check failed');
    } catch (e) {
      checks.db = 'fail';
      req.log.error({ err: e instanceof Error ? e.message : String(e) }, 'readyz: db check failed');
    }

    // Optional LLM probe (?llm=1) — diagnostics for the deployed bot.
    let llm: Record<string, unknown> | undefined;
    if ((req.query as { llm?: string })?.llm) {
      const cfg = loadConfig();
      llm = { provider: cfg.LLM_PROVIDER, model: cfg.GEMINI_MODEL, keyPresent: !!cfg.GEMINI_API_KEY };
      try {
        const c = await getLlmClient().classify('test kitna', { productNames: [] });
        llm.classify = 'ok';
        llm.intent = c.intent;
      } catch (e) {
        llm.classify = 'fail';
        llm.error = e instanceof Error ? e.message : String(e);
      }
    }

    const ready = Object.values(checks).every((v) => v === 'ok');
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', checks, ...(llm ? { llm } : {}) });
  });
}
