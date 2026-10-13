import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { loadConfig } from './config';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { adminRoutes } from './routes/admin';
import { signupRoutes } from './routes/signup';
import { onboardingRoutes } from './routes/onboarding';
import { notificationRoutes } from './routes/notifications';
import { whatsappRoutes } from './routes/whatsapp';
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
  // No CORS on purpose: nothing calls this API from a browser on another origin — the portal
  // proxies same-origin (admin/app/api/[...path]) — so browsers keep their default block.

  app.get('/', async () => ({ product: cfg.PRODUCT_NAME, status: 'running', version: '0.0.0' }));
  await app.register(healthRoutes);
  await app.register(webhookRoutes); // Phase 2: /api/v1/webhook/whatsapp
  await app.register(adminRoutes); // Phase 5: merchant admin API (pilot token-gated)
  await app.register(whatsappRoutes); // M2/M3: /api/v1/admin/whatsapp/* (own auth hook)
  await app.register(signupRoutes); // P1: self-service signup gate + bootstrap
  await app.register(onboardingRoutes); // P2: readiness + delivery zones (own auth hook)
  await app.register(notificationRoutes); // P3: push subscriptions, alert prefs, send-me-a-test (own auth hook)

  return app;
}
