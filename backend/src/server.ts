import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { loadConfig } from './config';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { adminRoutes } from './routes/admin';
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
  // Portal is a separate origin; allow the configured admin origin (or all in dev).
  await app.register(cors, { origin: cfg.ADMIN_ORIGIN ? [cfg.ADMIN_ORIGIN] : true, credentials: true });

  app.get('/', async () => ({ product: cfg.PRODUCT_NAME, status: 'running', version: '0.0.0' }));
  await app.register(healthRoutes);
  await app.register(webhookRoutes); // Phase 2: /api/v1/webhook/whatsapp
  await app.register(adminRoutes); // Phase 5: merchant admin API (pilot token-gated)

  return app;
}
