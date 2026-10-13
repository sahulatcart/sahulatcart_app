import crypto from 'node:crypto';
import { loadConfig } from '../config';

/**
 * The Meta Graph API calls the connect flow makes (SRS-Fazal Appendix A). Every call carries
 * `appsecret_proof` (HMAC-SHA256 of the token with the app secret), so a leaked token alone cannot
 * call the API once "Require App Secret" is on in the app's advanced settings (M7).
 *
 * Field names and error codes are from Meta's docs as of mid-2026 and must be re-checked against
 * the live docs when this first runs for real; the dashboard's API version drop-down is the source.
 */

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GrantedAssets {
  wabaIds: string[];
  expiresAt: Date | null;
}

export interface PhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null; // GREEN | YELLOW | RED | UNKNOWN
  nameStatus: string | null;
}

const TIMEOUT_MS = 15_000;

function appSecretProof(token: string): string {
  const secret = loadConfig().META_APP_SECRET;
  if (!secret) throw new Error('META_APP_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

/** One Graph call. Token in the header (never the URL, which ends up in logs), proof in the query. */
export async function graph<T>(
  path: string,
  token: string,
  opts: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: Record<string, unknown>; proof?: boolean } = {}
): Promise<T> {
  const cfg = loadConfig();
  const url = new URL(`https://graph.facebook.com/${cfg.META_GRAPH_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  if (opts.proof !== false) url.searchParams.set('appsecret_proof', appSecretProof(token));
  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  const err = (json as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
  if (!res.ok || err) {
    throw new GraphError(err?.message ?? `Meta returned HTTP ${res.status}`, err?.code ?? null, err?.error_subcode ?? null, res.status);
  }
  return json as T;
}

/** A.1 — swap the Embedded Signup code for the merchant's business token. Uses app credentials, no proof. */
export async function exchangeCode(code: string): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.META_APP_ID || !cfg.META_APP_SECRET) throw new Error('META_APP_ID / META_APP_SECRET are not set');
  const url = new URL(`https://graph.facebook.com/${cfg.META_GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', cfg.META_APP_ID);
  url.searchParams.set('client_secret', cfg.META_APP_SECRET);
  url.searchParams.set('code', code);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = (await res.json().catch(() => null)) as { access_token?: string; error?: { message?: string; code?: number; error_subcode?: number } } | null;
  if (!res.ok || !json?.access_token) {
    throw new GraphError(json?.error?.message ?? 'code exchange failed', json?.error?.code ?? null, json?.error?.error_subcode ?? null, res.status);
  }
  return json.access_token;
}

/** A.2 — which WABAs the token was granted for, and when it expires (0 = never). */
export async function grantedAssets(token: string): Promise<GrantedAssets> {
  const cfg = loadConfig();
  const json = await graph<{ data?: { expires_at?: number; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(
    'debug_token',
    `${cfg.META_APP_ID}|${cfg.META_APP_SECRET}`,
    { query: { input_token: token }, proof: false }
  );
  const ids = new Set<string>();
  for (const s of json.data?.granular_scopes ?? []) {
    if (s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging') {
      for (const id of s.target_ids ?? []) ids.add(id);
    }
  }
  const exp = json.data?.expires_at ?? 0;
  return { wabaIds: [...ids], expiresAt: exp > 0 ? new Date(exp * 1000) : null };
}

/** A.3 — the numbers on a WABA. */
export async function listPhoneNumbers(wabaId: string, token: string): Promise<PhoneNumber[]> {
  const json = await graph<{ data?: { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; name_status?: string }[] }>(
    `${wabaId}/phone_numbers`,
    token,
    { query: { fields: 'id,display_phone_number,verified_name,quality_rating,name_status' } }
  );
  return (json.data ?? []).map((n) => ({
    id: n.id,
    displayPhoneNumber: n.display_phone_number ?? '',
    verifiedName: n.verified_name ?? null,
    qualityRating: n.quality_rating ?? null,
    nameStatus: n.name_status ?? null,
  }));
}

/** A.4 — subscribe our app to the WABA's webhooks. */
export async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, token, { method: 'POST' });
}

/** A.5 — register the number for the Cloud API with a two-step PIN. */
export async function registerPhone(phoneNumberId: string, pin: string, token: string): Promise<void> {
  await graph<{ success?: boolean }>(`${phoneNumberId}/register`, token, { method: 'POST', body: { messaging_product: 'whatsapp', pin } });
}

/** A.12 — the number's WhatsApp business profile (text fields only; the picture needs the upload API). */
export interface BusinessProfile { about?: string; address?: string; description?: string; email?: string; websites?: string[] }
export async function updateBusinessProfile(phoneNumberId: string, token: string, profile: BusinessProfile): Promise<void> {
  await graph<{ success?: boolean }>(`${phoneNumberId}/whatsapp_business_profile`, token, { method: 'POST', body: { messaging_product: 'whatsapp', ...profile } });
}

// Registration error codes (Meta Cloud API). Re-check against the live docs when M2 first runs.
export const REG_PIN_MISMATCH = 133005;
export const REG_REVERIFY_NEEDED = 133006;
export const REG_LIMIT = 133016;
// Send error codes that the handshake maps to a plain-words reason.
export const SEND_PAYMENT_METHOD_MISSING = 131042;
export const SEND_WINDOW_CLOSED = 131047;
export const SEND_BAD_RECIPIENT = 131026;
