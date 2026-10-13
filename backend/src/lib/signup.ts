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
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return false;
  return cfg.SIGNUP_ALLOWLIST.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(e);
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
): Promise<{ merchantId: string; role: string } | { error: string }> {
  const r = await db.rpc('create_merchant_for_user', {
    p_auth_user: user.id,
    p_email: user.email,
    p_shop: p.shopName,
    p_owner: p.ownerName,
    p_phone: p.phone,
    p_attestations: p.attestations,
  });
  const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { merchant_id?: string; role?: string } | null;
  if (r.error || !row?.merchant_id) return { error: r.error?.message ?? 'could not create the shop' };
  await ensureTrial(db, row.merchant_id); // P7: 30 free days start now
  return { merchantId: row.merchant_id, role: row.role ?? 'owner' };
}
