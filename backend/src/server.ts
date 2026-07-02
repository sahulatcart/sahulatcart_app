import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { loadConfig } from './config';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { adminOrderRoutes } from './routes/admin-orders';
import { webhookRoutes } from './whatsapp/webhook';

/**
 * Builds the Fastify app. Route groups are registered here as phases land:
 *   Phase 2 → /api/v1/webhook/whatsapp
 *   Phase 3 → conversation orchestration (internal, not HTTP)
 *   Phase 5 → /api/v1/* admin API
 */
export async function buildServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const app = Fastify({ logger: loggerOptions, bodyLimit: cfg.WEBHOOK_MAX_BODY_BYTES });

  await app.register(helmet, { global: true });

  app.get('/', async () => ({ product: cfg.PRODUCT_NAME, status: 'running', version: '0.0.0' }));
  await app.register(healthRoutes);
  await app.register(webhookRoutes); // Phase 2: /api/v1/webhook/whatsapp
  await app.register(adminOrderRoutes); // Phase 4b: merchant verify/reject (pilot token-gated)

  return app;
}
