// Self-service signup (SRS P1): the allow-list gate and the one call that creates a shop.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig, type Config } from '../config';
import { isPakistaniMobile, phoneDigits } from './phone';
import { ensureTrial } from './billing';

/** merchants.settings for a shop that has not been through onboarding: the bot is OFF. */
export const NEW_MERCHANT_SETTINGS = {
  botEnabled: false,
  codEnabled: true,
  paymentInstructions: '',
  defaultDeliveryCharge: 0,
  freeDeliveryThreshold: 0,
  lowStockThreshold: 3,
  onboardingCompletedAt: null,
  metaCatalog: null,
} as const;

/** Until SIGNUP_OPEN=true only the comma-separated SIGNUP_ALLOWLIST may create a shop. */
export function signupAllowed(email: string | null | undefined, cfg: Pick<Config, 'SIGNUP_OPEN' | 'SIGNUP_ALLOWLIST'> = loadConfig()): boolean {
  if (cfg.SIGNUP_OPEN) return true;
  const e = typeof email === 'string' ? email.trim().toLowerCase() : ''; // review P1-7: {"email":5} used to crash here
  if (!e) return false;
  return cfg.SIGNUP_ALLOWLIST.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(e);
}

// ── U3: the gate lives in platform_settings (edited from /platform/access); the env vars are the
// fallback per key until a value is saved. Active platform admins are always allowed, so an invited
// admin can create their auth user and land on the 409 → /platform path. /api/v1/config is public,
// so the answer is cached for a minute; the PUT route clears it.
export interface SignupGate extends Pick<Config, 'SIGNUP_OPEN' | 'SIGNUP_ALLOWLIST'> {
  /** The stored (or env) list alone, for the panel; SIGNUP_ALLOWLIST adds the admins. */
  allowlist: string[];
  source: { open: 'db' | 'env'; allowlist: 'db' | 'env' };
}
const GATE_TTL_MS = 60_000;
let gateCache: { at: number; gate: SignupGate } | null = null;
/** Tests, and the PUT route. */
export const _resetSignupGateCache = (): void => { gateCache = null; };
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const cleanList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v.map((s) => s.trim().toLowerCase()).filter((s) => s && EMAIL_RE.test(s)))] : null);

export async function signupGate(db: SupabaseClient, env: Pick<Config, 'SIGNUP_OPEN' | 'SIGNUP_ALLOWLIST'> = loadConfig()): Promise<SignupGate> {
  if (gateCache && Date.now() - gateCache.at < GATE_TTL_MS) return gateCache.gate;
  const [{ data: rows }, { data: admins }] = await Promise.all([
    db.from('platform_settings').select('key, value').in('key', ['signup_open', 'signup_allowlist']),
    db.from('platform_admins').select('email').eq('is_active', true).not('email', 'is', null),
  ]);
  const byKey = new Map(((rows ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const openRow = byKey.get('signup_open');
  const listRow = cleanList(byKey.get('signup_allowlist'));
  const envList = env.SIGNUP_ALLOWLIST.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowlist = listRow ?? envList;
  const adminEmails = ((admins ?? []) as { email: string | null }[]).map((a) => (a.email ?? '').trim().toLowerCase()).filter(Boolean);
  const gate: SignupGate = {
    SIGNUP_OPEN: typeof openRow === 'boolean' ? openRow : env.SIGNUP_OPEN,
    SIGNUP_ALLOWLIST: [...allowlist, ...adminEmails].join(','),
    allowlist,
    source: { open: typeof openRow === 'boolean' ? 'db' : 'env', allowlist: listRow ? 'db' : 'env' },
  };
  gateCache = { at: Date.now(), gate };
  return gate;
}

/** A shop or owner name: 2–80 characters, no control characters. */
export function validName(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  // eslint-disable-next-line no-control-regex
  return s.length >= 2 && s.length <= 80 && !/[\x00-\x1f\x7f]/.test(s);
}

export interface SignupProfile {
  shopName: string;
  ownerName: string;
  phone: string; // digits only
  attestations: { noProhibitedGoods: true; optInOnly: true; at: string } | null;
}

/** Read the profile the signup form stored in the auth user's metadata (or sent in the body). */
export function signupProfile(src: Record<string, unknown>): SignupProfile | { error: string } {
  const shopName = typeof src.shopName === 'string' ? src.shopName.trim() : '';
  const ownerName = typeof src.ownerName === 'string' ? src.ownerName.trim() : '';
  const phone = phoneDigits(src.phone);
  if (!validName(shopName)) return { error: 'shopName must be 2–80 characters' };
  if (!validName(ownerName)) return { error: 'ownerName must be 2–80 characters' };
  if (!isPakistaniMobile(phone)) return { error: 'phone must be a Pakistani mobile number (+92 3xx xxxxxxx)' };
  const a = src.attestations as { noProhibitedGoods?: unknown; optInOnly?: unknown } | undefined;
  const attestations = a?.noProhibitedGoods === true && a?.optInOnly === true
    ? { noProhibitedGoods: true as const, optInOnly: true as const, at: new Date().toISOString() }
    : null;
  return { shopName, ownerName, phone, attestations };
}

/** Create the shop and owner membership in one transaction (migration 0012); idempotent per user. */
export async function bootstrapMerchant(
  db: SupabaseClient,
  user: { id: string; email: string },
  p: SignupProfile,
): Promise<{ merchantId: string; role: string } | { error: string; conflict?: 'inactive_membership' | 'email_in_use' }> {
  const r = await db.rpc('create_merchant_for_user', {
    p_auth_user: user.id,
    p_email: user.email,
    p_shop: p.shopName,
    p_owner: p.ownerName,
    p_phone: p.phone,
    p_attestations: p.attestations,
  });
  const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { merchant_id?: string; role?: string } | null;
  if (r.error || !row?.merchant_id) {
    // Review P1-5: migration 0019 raises SC001/SC002 for the two conflicts a merchant can do something about.
    const code = (r.error as { code?: string } | null)?.code;
    if (code === 'SC001' || r.error?.message === 'inactive_membership') return { conflict: 'inactive_membership', error: 'This login belonged to a shop that was deactivated. Contact support to reinstate it.' };
    if (code === 'SC002' || r.error?.message === 'email_in_use') return { conflict: 'email_in_use', error: 'A shop already uses this email. Sign in with it, or reset its password.' };
    return { error: 'could not create the shop' };
  }
  await ensureTrial(db, row.merchant_id); // P7: 30 free days start now
  return { merchantId: row.merchant_id, role: row.role ?? 'owner' };
}
