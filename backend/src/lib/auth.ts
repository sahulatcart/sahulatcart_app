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

async function jwtCtx(token: string): Promise<MerchantCtx | null> {
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) return null;
  const mu = await getServiceClient()
    .from('merchant_users')
    .select('id, merchant_id, role')
    .eq('auth_user_id', data.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!mu.data) return null;
  return { merchantId: mu.data.merchant_id as string, role: mu.data.role as Role, memberId: mu.data.id as string, isPlatformAdmin: false };
}

/**
 * Resolve the caller's merchant context (DUAL AUTH):
 *  (a) Authorization: Bearer <supabase-jwt> → verified user → their merchant_users membership.
 *  (b) ADMIN_API_TOKEN as the Bearer value or x-admin-token → platform-admin, scoped to the
 *      default merchant (pilot fallback).
 * merchant_id is ALWAYS derived here — never taken from client input.
 */
export async function resolveCtx(req: FastifyRequest): Promise<MerchantCtx | null> {
  const authz = req.headers.authorization;
  const bearer = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  // A JWT has three dot-separated parts; any other bearer value is an admin-token attempt.
  if (bearer && bearer.split('.').length === 3) return jwtCtx(bearer);
  return isAdminToken(bearer ?? req.headers['x-admin-token']) ? adminCtx() : null;
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
