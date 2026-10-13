// P6 (FR-P6.3): per-minute limits, keyed by merchant when the caller is signed in, else by IP.
// Pure helpers here so the policy is testable without the plugin; server.ts wires them in.
import type { FastifyRequest } from 'fastify';
import { authenticate } from './auth';

export type Bucket = 'signup' | 'login' | 'connect' | 'api';

/** Which limit a route falls under. The webhook and health routes are exempt (see `exempt`). */
export function bucketFor(url: string): Bucket {
  if (url.startsWith('/api/v1/signup/')) return 'signup';
  if (url === '/api/v1/admin/login') return 'login';
  if (url === '/api/v1/admin/whatsapp/connect') return 'connect';
  return 'api';
}

export const LIMITS: Record<Bucket, number> = { signup: 10, login: 10, connect: 5, api: 300 };

/** Meta bursts webhooks and uptime checks poll; neither may be throttled. */
export const exempt = (url: string): boolean => url.startsWith('/api/v1/webhook/') || url === '/healthz' || url === '/readyz' || url === '/';

/** `bucket:m:<merchantId>` for a signed-in caller, else `bucket:ip:<ip>`. The bucket is part of the key so a signup burst never eats into the API allowance. */
export async function rateLimitKey(req: FastifyRequest): Promise<string> {
  const bucket = bucketFor(req.routeOptions?.url ?? req.url);
  const a = bucket === 'api' || bucket === 'connect' ? await authenticate(req) : null;
  const who = a?.kind === 'ctx' ? `m:${a.ctx.merchantId}` : `ip:${req.ip}`;
  return `${bucket}:${who}`;
}

export const rateLimitMax = (req: FastifyRequest): number => LIMITS[bucketFor(req.routeOptions?.url ?? req.url)];

/** What the plugin throws on a hit; server.ts's error handler turns it into the API's usual `{ error }` shape. */
export const rateLimitError = (retryAfterSec: number) => ({ statusCode: 429, message: `Too many requests; try again in ${retryAfterSec}s` });
