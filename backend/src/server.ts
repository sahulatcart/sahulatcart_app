import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { exempt, rateLimitError, rateLimitKey, rateLimitMax } from './lib/rate-limit';
import { attachSentry } from './lib/sentry';
import { loadConfig } from './config';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { adminRoutes } from './routes/admin';
import { signupRoutes } from './routes/signup';
import { onboardingRoutes } from './routes/onboarding';
import { notificationRoutes } from './routes/notifications';
import { orderRoutes } from './routes/orders';
import { whatsappRoutes } from './routes/whatsapp';
import { usageRoutes } from './routes/usage';
import { platformRoutes } from './routes/platform';
import { platformOpsRoutes } from './routes/platform-ops';
import { webhookRoutes } from './whatsapp/webhook';
import { customerRoutes } from './routes/customers';
import { catalogRoutes } from './routes/catalog';
import { billingRoutes } from './routes/billing';

/**
 * Builds the Fastify app. Route groups are registered here as phases land:
 *   Phase 2 → /api/v1/webhook/whatsapp
 *   Phase 3 → conversation orchestration (internal, not HTTP)
 *   Phase 5 → /api/v1/* admin API
 */
export async function buildServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  // trustProxy: Railway terminates TLS and sets X-Forwarded-For; req.ip is its first hop, which
  // the rate limits and the admin-token lockout (P6) key on.
  const app = Fastify({ logger: loggerOptions, bodyLimit: cfg.WEBHOOK_MAX_BODY_BYTES, trustProxy: true });

  await app.register(helmet, { global: true });
  if (cfg.SENTRY_DSN) attachSentry(app); // P6: 5xx route errors; no-op without a DSN
  // P6 (FR-P6.3): per-minute limits. Keyed by merchant once signed in, else by IP; the webhook and
  // health routes are exempt. The store is in-process (one instance).
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    allowList: (req) => exempt(req.routeOptions?.url ?? req.url),
    keyGenerator: rateLimitKey,
    max: (req) => rateLimitMax(req),
    errorResponseBuilder: (_req, ctx) => rateLimitError(Math.ceil(ctx.ttl / 1000)),
  });
  // A rate-limit hit answers in the API's { error } shape (the portal reads error.message); everything else keeps Fastify's default.
  app.setErrorHandler((err, _req, reply) => {
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: err.message } });
    return reply.send(err);
  });
  // No CORS on purpose: nothing calls this API from a browser on another origin — the portal
  // proxies same-origin (admin/app/api/[...path]) — so browsers keep their default block.

  app.get('/', async () => ({ product: cfg.PRODUCT_NAME, status: 'running', version: '0.0.0' }));
  await app.register(healthRoutes);
  await app.register(webhookRoutes); // Phase 2: /api/v1/webhook/whatsapp
  await app.register(adminRoutes); // Phase 5: merchant admin API (pilot token-gated)
  await app.register(whatsappRoutes); // M2/M3: /api/v1/admin/whatsapp/* (own auth hook)
  await app.register(usageRoutes); // M5: /api/v1/admin/usage
  await app.register(platformRoutes); // M6: /api/v1/platform/* (platform owner only)
  await app.register(platformOpsRoutes); // F1/F2: audit, jobs, platform admins (own auth hook)
  await app.register(signupRoutes); // P1: self-service signup gate + bootstrap
  await app.register(onboardingRoutes); // P2: readiness + delivery zones (own auth hook)
  await app.register(notificationRoutes); // P3: push subscriptions, alert prefs, send-me-a-test (own auth hook)
  await app.register(orderRoutes); // P4: preparing / dispatched / delivered (own auth hook)
  await app.register(customerRoutes); // P5: block / unblock (own auth hook)
  await app.register(catalogRoutes); // P5: soft-delete a product (own auth hook)
  await app.register(billingRoutes); // P7: plan, usage, invoices, plan-change requests (own auth hook)

  return app;
}
