import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger';
import { notify, notifyPlatform } from '../lib/notify';
import { digitsOnly } from '../lib/phone';
import { forgetNumber } from './credentials';
import { applyTemplateStatus } from './templates';
import type { AccountEvent } from './types';

/**
 * Account-level webhook fields (SRS-Fazal M3): number quality, account restrictions, template
 * status. They carry no `metadata.phone_number_id`; the WABA id is `entry[].id`. A WABA-level event
 * applies to every number row with that `waba_id`. Notifications are written directly until the
 * notify() helper (P3) exists.
 *
 * Payload shapes are Meta's as of mid-2026 (Appendix A); re-check in the dashboard's webhook Test
 * button before the first real subscription (M7 step 3).
 */

type Tier = 'unverified' | 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';
const TIER: Record<string, Tier> = { TIER_250: 'unverified', TIER_1K: 'tier_1', TIER_10K: 'tier_2', TIER_100K: 'tier_3', TIER_UNLIMITED: 'tier_4' };

async function notifyMerchants(db: SupabaseClient, merchantIds: string[], type: 'system' | 'template_status', title: string, body: string, data: Record<string, unknown>): Promise<void> {
  for (const merchant_id of new Set(merchantIds)) {
    await notify(db, merchant_id, { type, title, body, data });
  }
}

/** U2: the founders' inbox gets the same message once per shop, for the flags only Nubrix can help with. */
async function tellFounders(db: SupabaseClient, merchantIds: string[], reason: 'policy' | 'token', body: string, event: string | undefined): Promise<void> {
  for (const merchantId of new Set(merchantIds)) {
    await notifyPlatform(db, { kind: 'whatsapp_attention', merchantId, title: 'WhatsApp needs attention', body, data: { reason, event: event ?? null } });
  }
}

type NumberRow = { merchant_id: string; phone_number_id: string; phone_e164: string | null; status: string; flag_reason: string | null };

async function numbersForWaba(db: SupabaseClient, wabaId: string): Promise<NumberRow[]> {
  const { data } = await db.from('whatsapp_numbers').select('merchant_id, phone_number_id, phone_e164, status, flag_reason').eq('waba_id', wabaId);
  return (data ?? []) as NumberRow[];
}

async function patchNumbers(db: SupabaseClient, rows: NumberRow[], patch: Record<string, unknown>): Promise<void> {
  for (const r of rows) {
    await db.from('whatsapp_numbers').update(patch).eq('phone_number_id', r.phone_number_id);
    forgetNumber(r.phone_number_id);
  }
}

/** `phone_number_quality_update`: { display_phone_number, event, current_limit }. */
async function onQualityUpdate(db: SupabaseClient, ev: AccountEvent): Promise<void> {
  const v = ev.value as { display_phone_number?: string; event?: string; current_limit?: string };
  const all = await numbersForWaba(db, ev.wabaId);
  const phone = digitsOnly(v.display_phone_number);
  const rows = phone ? all.filter((r) => digitsOnly(r.phone_e164) === phone) : all;
  if (!rows.length) {
    logger.warn({ wabaId: ev.wabaId, phone }, 'quality update for a number we do not hold');
    return;
  }
  const patch: Record<string, unknown> = {};
  const tier = v.current_limit ? TIER[v.current_limit] : undefined;
  if (tier) patch.messaging_tier = tier;
  const merchants = rows.map((r) => r.merchant_id);
  switch (v.event) {
    case 'FLAGGED':
      Object.assign(patch, { quality_rating: 'red', status: 'needs_attention', flag_reason: 'quality', attention_message: 'Meta has flagged this number for low quality. Customers may be blocking or reporting messages. Reply faster, never message people who did not write first, and keep the catalog accurate. Meta restores the number when quality recovers.' });
      await notifyMerchants(db, merchants, 'system', 'WhatsApp number flagged by Meta', 'Quality rating is red. Messaging may be restricted until it recovers.', { action: 'whatsapp_quality', event: v.event });
      break;
    case 'DOWNGRADE':
      Object.assign(patch, { quality_rating: 'yellow' });
      await notifyMerchants(db, merchants, 'system', 'WhatsApp quality dropped to yellow', 'Fewer messages can be sent until the rating recovers. Reply quickly and only to customers who wrote first.', { action: 'whatsapp_quality', event: v.event });
      break;
    case 'UNFLAGGED':
    case 'UPGRADE':
      Object.assign(patch, { quality_rating: 'green' });
      // Only a quality flag is cleared here; a token or policy flag stays.
      for (const r of rows) {
        if (r.status === 'needs_attention' && r.flag_reason === 'quality') {
          await db.from('whatsapp_numbers').update({ status: 'connected', flag_reason: null, attention_message: null }).eq('phone_number_id', r.phone_number_id);
        }
      }
      if (v.event === 'UNFLAGGED') await notifyMerchants(db, merchants, 'system', 'WhatsApp number restored', 'Meta has lifted the quality flag. The bot is sending normally again.', { action: 'whatsapp_quality', event: v.event });
      break;
    case 'ONBOARDING':
      patch.quality_rating = 'unknown';
      break;
    default:
      logger.info({ event: v.event }, 'quality update with an unknown event');
  }
  if (Object.keys(patch).length) await patchNumbers(db, rows, patch);
}

/** `account_update`: { phone_number?, event, ban_info?, restriction_info? }. */
async function onAccountUpdate(db: SupabaseClient, ev: AccountEvent): Promise<void> {
  const v = ev.value as { event?: string; ban_info?: { waba_ban_state?: string; waba_ban_date?: string }; restriction_info?: { restriction_type?: string; expiration?: string }[]; violation_info?: { violation_type?: string } };
  const rows = await numbersForWaba(db, ev.wabaId);
  if (!rows.length) {
    logger.warn({ wabaId: ev.wabaId, event: v.event }, 'account update for a WABA we do not hold');
    return;
  }
  const merchants = rows.map((r) => r.merchant_id);
  switch (v.event) {
    case 'DISABLED_UPDATE':
    case 'ACCOUNT_VIOLATION':
    case 'ACCOUNT_RESTRICTION': {
      const reason = v.ban_info?.waba_ban_state ?? v.violation_info?.violation_type ?? v.restriction_info?.map((r) => r.restriction_type).filter(Boolean).join(', ') ?? v.event;
      const message = `Meta has restricted this WhatsApp Business account (${reason}). Open Meta Business Manager → WhatsApp accounts to see the reason and appeal; the bot cannot send until Meta lifts it.`;
      await patchNumbers(db, rows, { status: 'needs_attention', flag_reason: 'policy', attention_message: message });
      await notifyMerchants(db, merchants, 'system', 'WhatsApp account restricted by Meta', message, { action: 'whatsapp_account', event: v.event, reason });
      await tellFounders(db, merchants, 'policy', message, v.event);
      break;
    }
    case 'PARTNER_REMOVED': {
      const message = 'Sahulatcart was removed from this WhatsApp Business account in Meta Business Manager. Reconnect from Settings → WhatsApp to continue.';
      await patchNumbers(db, rows, { status: 'needs_attention', flag_reason: 'token', attention_message: message });
      await notifyMerchants(db, merchants, 'system', 'WhatsApp disconnected', message, { action: 'reconnect_whatsapp', event: v.event });
      await tellFounders(db, merchants, 'token', message, v.event);
      break;
    }
    case 'VERIFIED_ACCOUNT':
      await notifyMerchants(db, merchants, 'system', 'Business verified by Meta', 'Your messaging limit will rise with good quality.', { action: 'whatsapp_account', event: v.event });
      break;
    default:
      logger.info({ event: v.event }, 'account update with an unhandled event');
  }
}

/** `message_template_status_update`: the row in message_templates, and a notification when the merchant must act (M4). */
async function onTemplateStatus(db: SupabaseClient, ev: AccountEvent): Promise<void> {
  await applyTemplateStatus(db, ev);
}

/** Dispatch one claimed account event. Never throws: an unknown field is logged and skipped. */
export async function handleAccountEvent(db: SupabaseClient, ev: AccountEvent): Promise<void> {
  switch (ev.field) {
    case 'phone_number_quality_update':
      return onQualityUpdate(db, ev);
    case 'account_update':
      return onAccountUpdate(db, ev);
    case 'message_template_status_update':
      return onTemplateStatus(db, ev);
    default:
      logger.info({ field: ev.field, wabaId: ev.wabaId }, 'webhook field without a handler');
  }
}
