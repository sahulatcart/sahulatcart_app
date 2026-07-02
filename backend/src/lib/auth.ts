import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from '../config';
import { getAnonClient, getServiceClient } from './supabase';

export type Role = 'owner' | 'manager' | 'staff';
export interface MerchantCtx {
  merchantId: string;
  role: Role;
  userId?: string;
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

/**
 * Resolve the caller's merchant context (DUAL AUTH):
 *  (a) Authorization: Bearer <supabase-jwt> → verified user → their merchant_users membership.
 *  (b) x-admin-token == ADMIN_API_TOKEN     → platform-admin, scoped to the default merchant (pilot fallback).
 * merchant_id is ALWAYS derived here — never taken from client input.
 */
export async function resolveCtx(req: FastifyRequest): Promise<MerchantCtx | null> {
  const cfg = loadConfig();
  const authz = req.headers.authorization;
  if (authz?.startsWith('Bearer ')) {
    const token = authz.slice(7).trim();
    // Not the admin token masquerading as a bearer — treat real JWTs only.
    if (cfg.ADMIN_API_TOKEN && token === cfg.ADMIN_API_TOKEN) {
      const mid = await defaultMerchantId();
      return mid ? { merchantId: mid, role: 'owner', isPlatformAdmin: true } : null;
    }
    const { data, error } = await getAnonClient().auth.getUser(token);
    if (error || !data.user) return null;
    const mu = await getServiceClient()
      .from('merchant_users')
      .select('merchant_id, role')
      .eq('auth_user_id', data.user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!mu.data) return null;
    return { merchantId: mu.data.merchant_id as string, role: mu.data.role as Role, userId: data.user.id, isPlatformAdmin: false };
  }
  const tok = req.headers['x-admin-token'];
  if (cfg.ADMIN_API_TOKEN && typeof tok === 'string' && tok === cfg.ADMIN_API_TOKEN) {
    const mid = await defaultMerchantId();
    return mid ? { merchantId: mid, role: 'owner', isPlatformAdmin: true } : null;
  }
  return null;
}

/** True if the role may take money-sensitive actions (verify/reject payments, edit bank accounts, see cost). */
export function canManagePayments(ctx: MerchantCtx): boolean {
  return ctx.isPlatformAdmin || ctx.role === 'owner' || ctx.role === 'manager';
}

export function forbid(reply: FastifyReply): void {
  reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'not allowed for your role' } });
}
