import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { decrypt, encrypt, fromBytea, toBytea } from '../lib/crypto';

/**
 * Per-merchant WhatsApp credentials (SRS-Fazal M1). Every send and media download resolves the
 * token from the number it acts for: whatsapp_numbers.access_token_ref → whatsapp_secrets → decrypt.
 *
 * The one env token (META_SYSTEM_USER_TOKEN) is used ONLY for the pilot number named by
 * META_DEFAULT_PHONE_NUMBER_ID, until that merchant reconnects through Embedded Signup (M2).
 * Any other number without credentials is refused, never silently sent with the platform token.
 */

export type RefusalReason = 'no_number' | 'disconnected' | 'token_invalid' | 'no_credentials' | 'decrypt_failed';
export type TokenLookup = { token: string; reason?: undefined } | { token: null; reason: RefusalReason };

const CACHE_MAX = 500;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { result: TokenLookup; at: number }>();

function remember(phoneNumberId: string, result: TokenLookup): TokenLookup {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(phoneNumberId, { result, at: Date.now() });
  return result;
}

/** Drop a number's cached lookup — after connect, reconnect, disconnect or a token failure. */
export function forgetNumber(phoneNumberId: string): void {
  cache.delete(phoneNumberId);
}

/** Test hook: clear every cached lookup. */
export function forgetAllNumbers(): void {
  cache.clear();
}

/** Encrypt and store a token; returns the whatsapp_secrets row id to put in access_token_ref. */
export async function storeToken(
  db: SupabaseClient,
  merchantId: string,
  token: string,
  kind: 'access_token' | 'pin' = 'access_token'
): Promise<string> {
  const sealed = encrypt(token);
  const { data, error } = await db
    .from('whatsapp_secrets')
    .insert({
      merchant_id: merchantId,
      kind,
      ciphertext: toBytea(sealed.ciphertext),
      iv: toBytea(sealed.iv),
      auth_tag: toBytea(sealed.authTag),
      key_id: sealed.keyId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`whatsapp_secrets insert failed: ${error?.message ?? 'no row'}`);
  return data.id as string;
}

/** Resolve the token for a number, with the refusal rules above. Cached for 10 minutes. */
export async function lookupToken(db: SupabaseClient, phoneNumberId: string): Promise<TokenLookup> {
  const hit = cache.get(phoneNumberId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const cfg = loadConfig();
  const isDefault = !!cfg.META_DEFAULT_PHONE_NUMBER_ID && phoneNumberId === cfg.META_DEFAULT_PHONE_NUMBER_ID;
  const envToken = isDefault && cfg.META_SYSTEM_USER_TOKEN ? cfg.META_SYSTEM_USER_TOKEN : null;

  const { data: num, error } = await db
    .from('whatsapp_numbers')
    .select('status, flag_reason, access_token_ref')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message, phoneNumberId }, 'whatsapp_numbers lookup failed');
    return { token: null, reason: 'no_number' }; // not cached: a DB blip should not stick for 10 min
  }
  if (!num) return remember(phoneNumberId, envToken ? { token: envToken } : { token: null, reason: 'no_number' });
  if (num.status === 'disconnected') return remember(phoneNumberId, { token: null, reason: 'disconnected' });
  if (num.status === 'needs_attention' && num.flag_reason === 'token') return remember(phoneNumberId, { token: null, reason: 'token_invalid' });
  if (!num.access_token_ref) return remember(phoneNumberId, envToken ? { token: envToken } : { token: null, reason: 'no_credentials' });

  const { data: secret } = await db
    .from('whatsapp_secrets')
    .select('ciphertext, iv, auth_tag, key_id')
    .eq('id', num.access_token_ref)
    .maybeSingle();
  if (!secret) return remember(phoneNumberId, { token: null, reason: 'no_credentials' });
  try {
    const token = decrypt({
      ciphertext: fromBytea(secret.ciphertext),
      iv: fromBytea(secret.iv),
      authTag: fromBytea(secret.auth_tag),
      keyId: secret.key_id as string,
    });
    return remember(phoneNumberId, { token });
  } catch (e) {
    logger.error({ err: (e as Error).message, phoneNumberId }, 'token decrypt failed');
    return remember(phoneNumberId, { token: null, reason: 'decrypt_failed' });
  }
}

/** The token, or null when the number may not send. */
export async function tokenForNumber(db: SupabaseClient, phoneNumberId: string): Promise<string | null> {
  return (await lookupToken(db, phoneNumberId)).token;
}

/**
 * Meta said the token is dead (error 190): stop sending from this number and tell the merchant.
 * The notification is written directly until the notify() helper (P3) exists.
 */
export async function markTokenInvalid(db: SupabaseClient, phoneNumberId: string): Promise<void> {
  forgetNumber(phoneNumberId);
  const message = 'WhatsApp disconnected: Meta no longer accepts this number’s access token. Reconnect it from Settings → WhatsApp.';
  const { data: num } = await db
    .from('whatsapp_numbers')
    .update({ status: 'needs_attention', flag_reason: 'token', attention_message: message })
    .eq('phone_number_id', phoneNumberId)
    .select('merchant_id')
    .maybeSingle();
  if (!num) return;
  await notify(db, num.merchant_id, { type: 'system', title: 'WhatsApp disconnected', body: message, data: { phoneNumberId, action: 'reconnect_whatsapp' } });
}
