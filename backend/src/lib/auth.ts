import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from '../config';
import { getAnonClient, getServiceClient } from './supabase';

export type Role = 'owner' | 'manager' | 'staff';
export interface MerchantCtx {
  merchantId: string;
  role: Role;
  memberId?: string; // merchant_users.id — what the *_by_user_id audit columns reference
  isPlatformAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    merchantCtx?: MerchantCtx;
  }
}

/** The single pilot/default merchant (token-auth path) — resolved via the default WhatsApp number. */
let defaultMerchantCache: string | undefined;
export async function defaultMerchantId(): Promise<string | undefined> {
  if (defaultMerchantCache) return defaultMerchantCache;
  const cfg = loadConfig();
  const db = getServiceClient();
  if (cfg.META_DEFAULT_PHONE_NUMBER_ID) {
    const r = await db.from('whatsapp_numbers').select('merchant_id').eq('phone_number_id', cfg.META_DEFAULT_PHONE_NUMBER_ID).maybeSingle();
    defaultMerchantCache = r.data?.merchant_id;
  }
  if (!defaultMerchantCache) {
    const m = await db.from('merchants').select('id').order('created_at').limit(1).maybeSingle();
    defaultMerchantCache = m.data?.id;
  }
  return defaultMerchantCache;
}

// Brute-force brake on the shared admin token: after 10 wrong guesses, every admin-token
// attempt (right or wrong) is refused until the 15-minute window rolls over. Portal
// logins use Supabase JWTs and are unaffected.
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60_000;
let fails = { n: 0, since: 0 };
const sha256 = (s: string): Buffer => crypto.createHash('sha256').update(s).digest();

/** Constant-time check against ADMIN_API_TOKEN (hashing equalises lengths for timingSafeEqual). */
export function isAdminToken(tok: unknown): boolean {
  const want = loadConfig().ADMIN_API_TOKEN;
  if (!want || typeof tok !== 'string' || !tok) return false;
  if (Date.now() - fails.since > FAIL_WINDOW_MS) fails = { n: 0, since: Date.now() };
  if (fails.n >= MAX_FAILS) return false;
  const ok = crypto.timingSafeEqual(sha256(tok), sha256(want));
  if (!ok) fails.n++;
  return ok;
}

async function adminCtx(): Promise<MerchantCtx | null> {
  const mid = await defaultMerchantId();
  return mid ? { merchantId: mid, role: 'owner', isPlatformAdmin: true } : null;
}

/** A verified Supabase user — who they are, with the metadata the signup form stored. */
export interface AuthUser {
  id: string;
  email: string;
  metadata: Record<string, unknown>;
}

/** The Bearer value when it looks like a JWT (three dot-separated parts), else null. */
function bearerJwt(req: FastifyRequest): string | null {
  const authz = req.headers.authorization;
  const bearer = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  return bearer && bearer.split('.').length === 3 ? bearer : null;
}

/**
 * Verify the JWT only — no merchant membership required. This is the one path a user takes
 * before they own a shop (POST /api/v1/signup/bootstrap). Everything else goes through resolveCtx.
 */
export async function resolveAuthUser(req: FastifyRequest): Promise<AuthUser | null> {
  const token = bearerJwt(req);
  if (!token) return null;
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email, metadata: (data.user.user_metadata ?? {}) as Record<string, unknown> };
}

/** A valid JWT whose user owns no shop yet: the portal redirects to /auth/confirmed, which bootstraps one. */
export const NO_MEMBERSHIP = { error: { code: 'no_membership', message: 'This login has no shop yet' } };

type Authn = { kind: 'ctx'; ctx: MerchantCtx } | { kind: 'no_membership' } | { kind: 'anonymous' };

async function jwtAuthn(token: string): Promise<Authn> {
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) return { kind: 'anonymous' };
  const mu = await getServiceClient()
    .from('merchant_users')
    .select('id, merchant_id, role')
    .eq('auth_user_id', data.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!mu.data) return { kind: 'no_membership' };
  return { kind: 'ctx', ctx: { merchantId: mu.data.merchant_id as string, role: mu.data.role as Role, memberId: mu.data.id as string, isPlatformAdmin: false } };
}

async function authenticate(req: FastifyRequest): Promise<Authn> {
  const jwt = bearerJwt(req);
  if (jwt) return jwtAuthn(jwt);
  const authz = req.headers.authorization;
  const bearer = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  const ctx = isAdminToken(bearer ?? req.headers['x-admin-token']) ? await adminCtx() : null;
  return ctx ? { kind: 'ctx', ctx } : { kind: 'anonymous' };
}

/**
 * preHandler for every merchant route (SRS Part 0.3): resolves the caller's shop into
 * req.merchantCtx or ends the request — 401 with no login, 401 `no_membership` for a user
 * without a shop, and 403 for a caller that has no shop to act on (a platform admin without a
 * membership, once M6 lets resolveCtx return one). New route files apply it themselves:
 *   app.addHook('preHandler', requireMerchant)
 */
export async function requireMerchant(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const a = await authenticate(req);
  if (a.kind === 'anonymous') return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } });
  if (a.kind === 'no_membership') return reply.code(401).send(NO_MEMBERSHIP);
  if (!a.ctx.merchantId) return reply.code(403).send({ error: { code: 'NO_SHOP', message: 'This account has no shop to act on' } });
  req.merchantCtx = a.ctx;
}

/**
 * Resolve the caller's merchant context (DUAL AUTH):
 *  (a) Authorization: Bearer <supabase-jwt> → verified user → their merchant_users membership.
 *  (b) ADMIN_API_TOKEN as the Bearer value or x-admin-token → platform-admin, scoped to the
 *      default merchant (pilot fallback).
 * merchant_id is ALWAYS derived here — never taken from client input.
 */
export async function resolveCtx(req: FastifyRequest): Promise<MerchantCtx | null> {
  const a = await authenticate(req);
  return a.kind === 'ctx' ? a.ctx : null;
}

/**
 * Owner, manager or platform admin (docs/spec/09 §2.3). Gates everything staff may not do:
 * verify/reject payments, bank accounts, catalog and settings writes, and reading `cost`.
 */
export function isManager(ctx: MerchantCtx): boolean {
  return ctx.isPlatformAdmin || ctx.role === 'owner' || ctx.role === 'manager';
}

export function forbid(reply: FastifyReply): void {
  reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Only an owner or manager can do this' } });
}
