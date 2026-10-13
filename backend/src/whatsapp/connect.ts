import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { digitsOnly, samePhone } from '../lib/phone';
import type { MerchantCtx } from '../lib/auth';
import { sendText } from './client';
import { forgetNumber, storeToken, tokenForNumber } from './credentials';
import {
  GraphError, exchangeCode, grantedAssets, listPhoneNumbers, registerPhone, subscribeApp, updateBusinessProfile,
  REG_LIMIT, REG_PIN_MISMATCH, REG_REVERIFY_NEEDED, SEND_BAD_RECIPIENT, SEND_PAYMENT_METHOD_MISSING, SEND_WINDOW_CLOSED,
  type PhoneNumber,
} from './meta-graph';
import { ensureTemplates, listTemplates } from './templates';
import type { NormalizedMessage } from './types';
import { formatHours } from '../lib/hours';

/**
 * "Connect WhatsApp" through Meta Embedded Signup (SRS-Fazal M2).
 *
 * The browser hands us only the single-use `code` plus the ids Meta's popup reported as HINTS; the
 * backend verifies them against what the token was actually granted. Connection is proven by a
 * handshake, not an outbound test: the merchant texts their own shop number, the bot's reply is the
 * proof that routing, the token and the merchant's payment method all work (FR-M2.8).
 */

export type ConnectError =
  | { status: 400; code: 'code_exchange_failed' | 'waba_not_granted' | 'phone_not_in_waba' | 'bad_request'; message: string }
  | { status: 409; code: 'choose_number'; message: string; numbers: { id: string; displayPhone: string; verifiedName: string | null }[] }
  | { status: 409; code: 'number_in_use'; message: string }
  | { status: 500; code: 'meta_not_configured'; message: string };

export class ConnectFailure extends Error {
  constructor(public readonly err: ConnectError) {
    super(err.message);
  }
}

export interface ConnectionStatus {
  status: 'none' | 'connecting' | 'connected' | 'needs_attention' | 'disconnected';
  phoneNumberId?: string;
  displayPhone?: string;
  displayName?: string | null;
  qualityRating?: string;
  messagingTier?: string;
  verifiedNameStatus?: string | null;
  flagReason?: string | null;
  message?: string | null;
  lastTestAt?: string | null;
  awaitingHandshake?: boolean;
  pinRequired?: boolean;
  isTestNumber?: boolean;
  merchantPhone?: string | null;
  templates: { name: string; status: string; rejectionReason: string | null }[];
}

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
const newPin = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const qualityEnum = (q: string | null): 'green' | 'yellow' | 'red' | 'unknown' => {
  const v = (q ?? '').toLowerCase();
  return v === 'green' || v === 'yellow' || v === 'red' ? v : 'unknown';
};

async function attemptUpdate(db: SupabaseClient, attemptId: string, patch: Record<string, unknown>): Promise<void> {
  await db.from('whatsapp_connect_attempts').update(patch).eq('id', attemptId);
}

/** The merchant-facing view of their number (IC-4). M3 adds quality/account events and templates. */
export async function getConnectionStatus(db: SupabaseClient, merchantId: string): Promise<ConnectionStatus> {
  const cfg = loadConfig();
  const [{ data: num }, { data: merchant }, { data: attempt }] = await Promise.all([
    db.from('whatsapp_numbers').select('*').eq('merchant_id', merchantId).neq('status', 'disconnected').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('merchants').select('phone').eq('id', merchantId).maybeSingle(),
    db.from('whatsapp_connect_attempts').select('error_code, status').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!num) return { status: 'none', templates: [], merchantPhone: merchant?.phone ?? null };
  const templates = (await listTemplates(db, merchantId)).map((t) => ({ name: t.name, status: t.status, rejectionReason: t.rejection_reason }));
  const status = (['connecting', 'connected', 'needs_attention', 'disconnected'] as const).find((s) => s === num.status) ?? 'needs_attention';
  return {
    status,
    phoneNumberId: num.phone_number_id,
    displayPhone: num.phone_e164 ?? undefined,
    displayName: num.display_name ?? null,
    qualityRating: num.quality_rating ?? 'unknown',
    messagingTier: num.messaging_tier ?? 'unverified',
    verifiedNameStatus: num.verified_name_status ?? null,
    flagReason: num.flag_reason ?? null,
    message: num.attention_message ?? null,
    lastTestAt: num.last_test_at ?? null,
    awaitingHandshake: status === 'connecting',
    pinRequired: status === 'needs_attention' && attempt?.error_code === String(REG_PIN_MISMATCH),
    isTestNumber: !!cfg.META_DEFAULT_PHONE_NUMBER_ID && num.phone_number_id === cfg.META_DEFAULT_PHONE_NUMBER_ID,
    merchantPhone: merchant?.phone ?? null,
    templates,
  };
}

/** Subscribe + register, shared by connect and retry. Returns the attention state, or null when fine. */
async function subscribeAndRegister(
  db: SupabaseClient,
  merchantId: string,
  wabaId: string,
  phoneNumberId: string,
  token: string,
  pin: string,
  attemptId: string
): Promise<{ flagReason: 'manual'; message: string; errorCode: string } | null> {
  try {
    await subscribeApp(wabaId, token);
    await attemptUpdate(db, attemptId, { status: 'subscribed' });
  } catch (e) {
    const g = e as GraphError;
    return { flagReason: 'manual', message: `Meta refused to subscribe this account: ${g.message}`, errorCode: String(g.code ?? g.httpStatus ?? 'subscribe') };
  }
  try {
    await registerPhone(phoneNumberId, pin, token);
  } catch (e) {
    const g = e as GraphError;
    if (g.code === REG_PIN_MISMATCH) {
      return { flagReason: 'manual', message: 'This number already has a two-step verification PIN. Enter the PIN you set for it, then press Retry.', errorCode: String(REG_PIN_MISMATCH) };
    }
    if (g.code === REG_REVERIFY_NEEDED) {
      return { flagReason: 'manual', message: 'Verify this number again in WhatsApp Manager (Phone numbers → Verify), then press Retry.', errorCode: String(REG_REVERIFY_NEEDED) };
    }
    if (g.code === REG_LIMIT) {
      return { flagReason: 'manual', message: 'Meta limits how often a number can be registered. Try again in a few hours.', errorCode: String(REG_LIMIT) };
    }
    return { flagReason: 'manual', message: `Meta could not register this number: ${g.message}`, errorCode: String(g.code ?? g.httpStatus ?? 'register') };
  }
  await storeToken(db, merchantId, pin, 'pin');
  await attemptUpdate(db, attemptId, { status: 'registered' });
  return null;
}

export interface ConnectInput {
  code: string;
  hints?: { wabaId?: string; phoneNumberId?: string };
  phoneNumberId?: string;
}

export async function connectWhatsApp(db: SupabaseClient, ctx: MerchantCtx, input: ConnectInput): Promise<ConnectionStatus> {
  const cfg = loadConfig();
  if (!cfg.META_APP_ID || !cfg.META_APP_SECRET) {
    throw new ConnectFailure({ status: 500, code: 'meta_not_configured', message: 'META_APP_ID and META_APP_SECRET must be set' });
  }
  if (!input.code || typeof input.code !== 'string') throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'code is required' });

  // FR-M2.10 idempotency: the same single-use code posted twice returns the current state.
  const codeHash = sha256(input.code);
  const { data: seen } = await db.from('whatsapp_connect_attempts').select('id').eq('code_hash', codeHash).maybeSingle();
  if (seen) return getConnectionStatus(db, ctx.merchantId);

  const { data: attempt, error: attemptErr } = await db
    .from('whatsapp_connect_attempts')
    .insert({ merchant_id: ctx.merchantId, member_id: ctx.memberId ?? null, status: 'started', code_hash: codeHash })
    .select('id')
    .single();
  if (attemptErr || !attempt) throw new Error(`connect attempt insert failed: ${attemptErr?.message}`);
  const attemptId = attempt.id as string;
  const fail = async (err: ConnectError, secretId?: string): Promise<never> => {
    if (secretId) await db.from('whatsapp_secrets').delete().eq('id', secretId);
    await attemptUpdate(db, attemptId, { status: 'failed', error_code: err.code, error_message: err.message.slice(0, 500) });
    throw new ConnectFailure(err);
  };

  // A.1 — the token.
  let token: string;
  try {
    token = await exchangeCode(input.code);
  } catch (e) {
    return fail({ status: 400, code: 'code_exchange_failed', message: `Meta did not accept the login: ${(e as Error).message}` });
  }
  const secretId = await storeToken(db, ctx.merchantId, token);
  await attemptUpdate(db, attemptId, { status: 'token_ok' });

  // A.2 — what the token was actually granted; the popup's ids are only hints.
  let granted: Awaited<ReturnType<typeof grantedAssets>>;
  try {
    granted = await grantedAssets(token);
  } catch (e) {
    return fail({ status: 400, code: 'code_exchange_failed', message: `Could not inspect the Meta login: ${(e as Error).message}` }, secretId);
  }
  const hintWaba = input.hints?.wabaId;
  if (hintWaba && !granted.wabaIds.includes(hintWaba)) {
    return fail({ status: 400, code: 'waba_not_granted', message: 'The WhatsApp account the popup reported was not granted to Sahulatcart. Try connecting again and pick the account you manage.' }, secretId);
  }
  if (granted.wabaIds.length === 0) {
    return fail({ status: 400, code: 'waba_not_granted', message: 'No WhatsApp Business account was shared with Sahulatcart. Try again and choose or create one in the popup.' }, secretId);
  }

  // A.3 — the numbers; pick by hint, by explicit choice, or the only one.
  const wantedPhone = input.phoneNumberId ?? input.hints?.phoneNumberId;
  const candidateWabas = hintWaba ? [hintWaba] : granted.wabaIds;
  const numbers: (PhoneNumber & { wabaId: string })[] = [];
  for (const w of candidateWabas) {
    try {
      numbers.push(...(await listPhoneNumbers(w, token)).map((n) => ({ ...n, wabaId: w })));
    } catch (e) {
      logger.warn({ err: (e as Error).message, wabaId: w }, 'phone_numbers listing failed');
    }
  }
  let chosen: (PhoneNumber & { wabaId: string }) | undefined;
  if (wantedPhone) {
    chosen = numbers.find((n) => n.id === wantedPhone);
    if (!chosen) return fail({ status: 400, code: 'phone_not_in_waba', message: 'That phone number is not on the WhatsApp account you shared. Try connecting again.' }, secretId);
  } else if (numbers.length === 1 && numbers[0]) {
    chosen = numbers[0];
  } else {
    await db.from('whatsapp_secrets').delete().eq('id', secretId);
    await attemptUpdate(db, attemptId, { status: 'failed', error_code: 'choose_number', error_message: `${numbers.length} numbers` });
    throw new ConnectFailure({
      status: 409,
      code: 'choose_number',
      message: numbers.length ? 'Which number should the bot use?' : 'The shared WhatsApp account has no phone number yet. Add one in WhatsApp Manager, then connect again.',
      numbers: numbers.map((n) => ({ id: n.id, displayPhone: n.displayPhoneNumber, verifiedName: n.verifiedName })),
    });
  }
  if (!chosen) return fail({ status: 400, code: 'phone_not_in_waba', message: 'No usable phone number was found.' }, secretId);
  await attemptUpdate(db, attemptId, { status: 'verified', waba_id: chosen.wabaId, phone_number_id: chosen.id });

  // FR-M2.7 — one number per merchant; a number another shop owns is never taken over.
  const { data: owner } = await db.from('whatsapp_numbers').select('merchant_id').eq('phone_number_id', chosen.id).maybeSingle();
  if (owner && owner.merchant_id !== ctx.merchantId) {
    return fail({ status: 409, code: 'number_in_use', message: 'This number is already connected to another Sahulatcart shop.' }, secretId);
  }
  const { data: olds } = await db.from('whatsapp_numbers').select('phone_number_id, access_token_ref').eq('merchant_id', ctx.merchantId).neq('phone_number_id', chosen.id);
  for (const old of olds ?? []) {
    if (old.access_token_ref) await db.from('whatsapp_secrets').delete().eq('id', old.access_token_ref);
    await db.from('whatsapp_numbers').update({ status: 'disconnected', access_token_ref: null, flag_reason: null, attention_message: null }).eq('phone_number_id', old.phone_number_id);
    forgetNumber(old.phone_number_id);
  }

  // A.4 + A.5 — subscribe and register, with the raw token (the number row does not exist yet).
  const attention = await subscribeAndRegister(db, ctx.merchantId, chosen.wabaId, chosen.id, token, newPin(), attemptId);

  await db.from('whatsapp_numbers').upsert(
    {
      merchant_id: ctx.merchantId,
      phone_number_id: chosen.id,
      waba_id: chosen.wabaId,
      display_name: chosen.verifiedName,
      phone_e164: digitsOnly(chosen.displayPhoneNumber),
      quality_rating: qualityEnum(chosen.qualityRating),
      verified_name_status: chosen.nameStatus,
      status: attention ? 'needs_attention' : 'connecting',
      flag_reason: attention?.flagReason ?? null,
      attention_message: attention?.message ?? null,
      access_token_ref: secretId,
      token_expires_at: granted.expiresAt?.toISOString() ?? null,
      token_rotated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number_id' }
  );
  forgetNumber(chosen.id);
  await attemptUpdate(db, attemptId, attention ? { error_code: attention.errorCode, error_message: attention.message } : { status: 'awaiting_handshake' });
  return getConnectionStatus(db, ctx.merchantId);
}

/** Re-run subscribe → register → handshake wait without a new popup, optionally with the merchant's own PIN. */
export async function retryConnect(db: SupabaseClient, ctx: MerchantCtx, pin?: string): Promise<ConnectionStatus> {
  const { data: num } = await db
    .from('whatsapp_numbers')
    .select('phone_number_id, waba_id, status, flag_reason')
    .eq('merchant_id', ctx.merchantId)
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!num) throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'No number to retry. Connect WhatsApp first.' });
  if (pin !== undefined && !/^\d{6}$/.test(pin)) throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'The PIN is six digits.' });
  const token = await tokenForNumber(db, num.phone_number_id);
  if (!token) throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'This number has no usable credentials. Connect WhatsApp again.' });
  const { data: attempt } = await db
    .from('whatsapp_connect_attempts')
    .insert({ merchant_id: ctx.merchantId, member_id: ctx.memberId ?? null, status: 'token_ok', waba_id: num.waba_id, phone_number_id: num.phone_number_id })
    .select('id')
    .single();
  const attention = await subscribeAndRegister(db, ctx.merchantId, num.waba_id, num.phone_number_id, token, pin ?? newPin(), attempt?.id as string);
  await db
    .from('whatsapp_numbers')
    .update({ status: attention ? 'needs_attention' : 'connecting', flag_reason: attention?.flagReason ?? null, attention_message: attention?.message ?? null })
    .eq('phone_number_id', num.phone_number_id);
  forgetNumber(num.phone_number_id);
  if (attempt?.id) await attemptUpdate(db, attempt.id as string, attention ? { error_code: attention.errorCode, error_message: attention.message } : { status: 'awaiting_handshake' });
  return getConnectionStatus(db, ctx.merchantId);
}

/** The plain-words reason a send to the merchant's own phone failed, and how it flags the number. */
function sendFailure(code: number | string | undefined): { message: string; flagReason: 'policy' | 'manual' } {
  if (code === SEND_PAYMENT_METHOD_MISSING) return { flagReason: 'policy', message: 'Add a payment method to your WhatsApp Business account in Meta Business Manager (Billing), then press Retry.' };
  if (code === SEND_BAD_RECIPIENT) return { flagReason: 'manual', message: 'This number cannot message your phone. Check the phone you saved in your shop profile is a WhatsApp number, then press Retry.' };
  if (code === SEND_WINDOW_CLOSED) return { flagReason: 'manual', message: 'Meta refused the reply. Send another message from your phone and we will try again.' };
  return { flagReason: 'manual', message: `The test reply failed (${String(code ?? 'unknown')}). Press Retry, or reconnect.` };
}

/**
 * FR-M3.7 — push the shop's name, address, description and hours to the number's WhatsApp
 * business profile. Best effort: a failure is logged, never surfaced to a buyer flow. The address
 * comes from the knowledgebase (`settings.kb.address`) until P2 adds `merchants.address`.
 */
export async function syncBusinessProfile(db: SupabaseClient, merchantId: string): Promise<boolean> {
  const [{ data: num }, { data: m }] = await Promise.all([
    db.from('whatsapp_numbers').select('phone_number_id, status').eq('merchant_id', merchantId).in('status', ['connected', 'connecting']).limit(1).maybeSingle(),
    db.from('merchants').select('business_name, settings, business_hours, email, address').eq('id', merchantId).maybeSingle(),
  ]);
  if (!num || !m) return false;
  const token = await tokenForNumber(db, num.phone_number_id);
  if (!token) return false;
  const kb = ((m.settings as { kb?: { address?: string; hours?: string; delivery?: string } } | null)?.kb) ?? {};
  // P2 step 1 writes merchants.address and business_hours; the knowledgebase text is the fallback.
  const address = (typeof m.address === 'string' && m.address.trim()) || kb.address?.trim();
  const hoursText = formatHours(m.business_hours) ?? kb.hours?.trim();
  const profile = {
    about: String(m.business_name ?? '').slice(0, 139),
    ...(address ? { address: address.slice(0, 256) } : {}),
    description: [hoursText ? `Hours: ${hoursText}` : '', kb.delivery?.trim() ? `Delivery: ${kb.delivery.trim()}` : ''].filter(Boolean).join('. ').slice(0, 512) || `${m.business_name} on WhatsApp`,
    ...(m.email ? { email: String(m.email).slice(0, 128) } : {}),
  };
  try {
    await updateBusinessProfile(num.phone_number_id, token, profile);
    return true;
  } catch (e) {
    logger.warn({ err: (e as Error).message, merchantId }, 'business profile sync failed');
    return false;
  }
}

/**
 * FR-M3.3 — send the test line to the merchant's own phone again. Works while their 24-hour window
 * with the shop is open (they texted it recently); when it has closed, Meta refuses (131047) and the
 * number goes back to `connecting` so the handshake proves it again.
 */
export async function sendTestMessage(db: SupabaseClient, ctx: MerchantCtx): Promise<ConnectionStatus> {
  const cfg = loadConfig();
  const [{ data: num }, { data: m }] = await Promise.all([
    db.from('whatsapp_numbers').select('phone_number_id').eq('merchant_id', ctx.merchantId).neq('status', 'disconnected').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('merchants').select('business_name, phone').eq('id', ctx.merchantId).maybeSingle(),
  ]);
  if (!num) throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'No number to test. Connect WhatsApp first.' });
  const to = digitsOnly(m?.phone);
  if (!to) throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'Save your own phone number in the shop profile first.' });
  const sent = await sendText(num.phone_number_id, to, `${m?.business_name ?? 'Your shop'} ↔ ${cfg.PRODUCT_NAME}: test message. Bot is number se jawab de raha hai ✓`);
  const now = new Date().toISOString();
  if (sent.waMessageId) {
    await db.from('whatsapp_numbers').update({ status: 'connected', flag_reason: null, attention_message: null, last_test_at: now }).eq('phone_number_id', num.phone_number_id);
  } else if (sent.errorCode === SEND_WINDOW_CLOSED) {
    await db.from('whatsapp_numbers').update({ status: 'connecting', flag_reason: null, attention_message: null }).eq('phone_number_id', num.phone_number_id);
  } else if (sent.errorCode === 'disconnected' || sent.errorCode === 'token_invalid' || sent.errorCode === 'no_credentials') {
    throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'This number has no usable credentials. Reconnect WhatsApp.' });
  } else {
    const f = sendFailure(sent.errorCode);
    await db.from('whatsapp_numbers').update({ status: 'needs_attention', flag_reason: f.flagReason, attention_message: f.message, last_test_at: now }).eq('phone_number_id', num.phone_number_id);
  }
  forgetNumber(num.phone_number_id);
  return getConnectionStatus(db, ctx.merchantId);
}

/**
 * FR-M3.4 — stop sending from this number. Secrets are deleted and the row kept (conversations
 * reference it); Meta is not told, so the merchant keeps their number and WABA. Inbound messages
 * still arrive and are stored; the merchant is reminded daily.
 */
export async function disconnectWhatsApp(db: SupabaseClient, ctx: MerchantCtx): Promise<ConnectionStatus> {
  const { data: rows } = await db.from('whatsapp_numbers').select('phone_number_id, access_token_ref').eq('merchant_id', ctx.merchantId).neq('status', 'disconnected');
  if (!rows?.length) throw new ConnectFailure({ status: 400, code: 'bad_request', message: 'No connected number.' });
  for (const r of rows) {
    if (r.access_token_ref) await db.from('whatsapp_secrets').delete().eq('id', r.access_token_ref);
    await db.from('whatsapp_numbers').update({ status: 'disconnected', access_token_ref: null, flag_reason: null, attention_message: null }).eq('phone_number_id', r.phone_number_id);
    forgetNumber(r.phone_number_id);
  }
  await db.from('whatsapp_secrets').delete().match({ merchant_id: ctx.merchantId, kind: 'pin' });
  return getConnectionStatus(db, ctx.merchantId);
}

export interface HandshakeTenant {
  phone_number_id: string;
  merchant_id: string;
  business_name: string;
  status: string;
  merchant_phone: string | null;
}

/**
 * FR-M2.8 — the merchant texted their own shop number while it was `connecting`. Reply, and mark
 * the number connected only if the reply went out. Returns true when the message was the
 * handshake (the caller stores it but does not run the bot on it).
 */
export async function handleConnectHandshake(db: SupabaseClient, tenant: HandshakeTenant, msg: NormalizedMessage): Promise<boolean> {
  if (tenant.status !== 'connecting' || !samePhone(msg.from, tenant.merchant_phone)) return false;
  const cfg = loadConfig();
  const sent = await sendText(tenant.phone_number_id, msg.from, `${tenant.business_name} ab ${cfg.PRODUCT_NAME} se connected hai ✓ Bot is number par customers ko jawab dega.`);
  const now = new Date().toISOString();
  if (sent.waMessageId) {
    await db.from('whatsapp_numbers').update({ status: 'connected', flag_reason: null, attention_message: null, last_test_at: now }).eq('phone_number_id', tenant.phone_number_id);
    await db.from('whatsapp_connect_attempts').update({ status: 'connected' }).match({ merchant_id: tenant.merchant_id, status: 'awaiting_handshake' });
    forgetNumber(tenant.phone_number_id);
    logger.info({ phoneNumberId: tenant.phone_number_id, merchantId: tenant.merchant_id }, 'WhatsApp number connected');
    // Best effort, after the number is proven working: the profile, then the two templates (M4).
    void syncBusinessProfile(db, tenant.merchant_id).then(() => ensureTemplates(db, tenant.merchant_id)).catch((e: unknown) => logger.warn({ err: String(e) }, 'post-handshake setup failed'));
    return true;
  }
  const code = sent.errorCode;
  const { message, flagReason } = sendFailure(code);
  await db.from('whatsapp_numbers').update({ status: 'needs_attention', flag_reason: flagReason, attention_message: message, last_test_at: now }).eq('phone_number_id', tenant.phone_number_id);
  await db.from('whatsapp_connect_attempts').update({ error_code: String(code ?? 'send'), error_message: message }).match({ merchant_id: tenant.merchant_id, status: 'awaiting_handshake' });
  forgetNumber(tenant.phone_number_id);
  return true;
}
