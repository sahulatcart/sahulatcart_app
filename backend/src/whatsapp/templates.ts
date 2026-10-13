import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { tokenForNumber } from './credentials';
import { GraphError, createTemplate, type TemplateComponent } from './meta-graph';
import type { AccountEvent } from './types';

/**
 * Message templates (SRS-Fazal M4). Two UTILITY templates per shop, created automatically after
 * the handshake proves the number. They are the ONLY way to message a buyer whose 24-hour window
 * has closed, and since 1 October 2026 every template send is charged, so nothing sends one
 * automatically: the merchant presses a button that shows the price (payment-service notifyBuyerNow).
 *
 * Language is `en`: Roman Urdu is Latin script and Meta has no code for it. If Meta rejects for
 * "language mismatch", resubmit with a shorter, more English body (FR-M4.1).
 */

export interface TemplateDef {
  base: string;
  category: 'UTILITY';
  language: string;
  body: string;
  example: string[];
}

export const TEMPLATE_DEFS: Record<'payment_update' | 'order_sent', TemplateDef> = {
  payment_update: {
    base: 'payment_update',
    category: 'UTILITY',
    language: 'en',
    body: 'Assalam o alaikum {{1}}! Aapke order {{2}} ki payment {{3}}. {{4}}',
    example: ['Ali', 'SK-1001', 'verify ho gayi hai', 'Jald deliver karenge, shukriya!'],
  },
  order_sent: {
    base: 'order_sent',
    category: 'UTILITY',
    language: 'en',
    body: '{{1}}, aapka order {{2}} bhej diya gaya hai. {{3}}',
    example: ['Ali', 'SK-1001', 'Jald pohanch jaye ga, shukriya!'],
  },
};
export type TemplateKind = keyof typeof TEMPLATE_DEFS;

const paramCount = (body: string): number => (body.match(/\{\{\d+\}\}/g) ?? []).length;
const components = (def: TemplateDef): TemplateComponent[] => [{ type: 'BODY', text: def.body, example: { body_text: [def.example] } }];

/** Meta's uppercase event → our lowercase status column. */
export function templateStatusFromEvent(event: string | undefined): string | null {
  const v = (event ?? '').toUpperCase();
  if (v === 'APPROVED') return 'approved';
  if (v === 'REJECTED') return 'rejected';
  if (v === 'PAUSED') return 'paused';
  if (v === 'DISABLED') return 'disabled';
  if (v === 'PENDING' || v === 'IN_APPEAL' || v === 'PENDING_DELETION') return 'pending';
  return null;
}

export interface TemplateRow { id: string; name: string; status: string; language: string; rejection_reason: string | null; wa_template_id: string | null; created_at: string }

export async function listTemplates(db: SupabaseClient, merchantId: string): Promise<TemplateRow[]> {
  const { data } = await db.from('message_templates').select('id, name, status, language, rejection_reason, wa_template_id, created_at').eq('merchant_id', merchantId).order('created_at', { ascending: true });
  return (data ?? []) as TemplateRow[];
}

/** The newest approved template of a kind (`payment_update`, `payment_update_v2`, …), if any. */
export async function approvedTemplate(db: SupabaseClient, merchantId: string, kind: TemplateKind): Promise<TemplateRow | null> {
  const rows = (await listTemplates(db, merchantId)).filter((t) => t.status === 'approved' && (t.name === kind || t.name.startsWith(`${kind}_v`)));
  return rows.at(-1) ?? null;
}

async function wabaAndToken(db: SupabaseClient, merchantId: string): Promise<{ wabaId: string; token: string; phoneNumberId: string } | null> {
  const { data: num } = await db.from('whatsapp_numbers').select('phone_number_id, waba_id').eq('merchant_id', merchantId).in('status', ['connected', 'connecting']).limit(1).maybeSingle();
  if (!num?.waba_id) return null;
  const token = await tokenForNumber(db, num.phone_number_id);
  return token ? { wabaId: num.waba_id, token, phoneNumberId: num.phone_number_id } : null;
}

async function submit(db: SupabaseClient, merchantId: string, wabaId: string, token: string, name: string, def: TemplateDef, actor: { memberId?: string } | null, action: 'template_submit' | 'template_resubmit'): Promise<TemplateRow | null> {
  const comps = components(def);
  let created: { id?: string; status?: string };
  try {
    created = await createTemplate(wabaId, token, { name, language: def.language, category: def.category, components: comps });
  } catch (e) {
    const g = e as GraphError;
    logger.warn({ err: g.message, code: g.code, merchantId, name }, 'template creation refused by Meta');
    return null;
  }
  const { data } = await db
    .from('message_templates')
    .upsert(
      {
        merchant_id: merchantId,
        waba_id: wabaId,
        wa_template_id: created.id ?? null,
        name,
        language: def.language,
        category: def.category.toLowerCase(),
        status: templateStatusFromEvent(created.status) ?? 'pending',
        rejection_reason: null,
        body_json: comps,
        param_count: paramCount(def.body),
      },
      { onConflict: 'merchant_id,name' }
    )
    .select('id, name, status, language, rejection_reason, wa_template_id, created_at')
    .single();
  await db.from('audit_log').insert({ merchant_id: merchantId, actor: actor ? 'agent' : 'system', user_id: actor?.memberId ?? null, action, entity: 'template', entity_id: data?.id ?? null, diff: { name, wa_template_id: created.id ?? null } });
  return (data as TemplateRow | null) ?? null;
}

/** Create the two templates for a shop that doesn't have them yet. Idempotent; best effort per template. */
export async function ensureTemplates(db: SupabaseClient, merchantId: string): Promise<TemplateRow[]> {
  const creds = await wabaAndToken(db, merchantId);
  if (!creds) return [];
  const existing = await listTemplates(db, merchantId);
  const out: TemplateRow[] = [];
  for (const def of Object.values(TEMPLATE_DEFS)) {
    if (existing.some((t) => t.name === def.base || t.name.startsWith(`${def.base}_v`))) continue;
    const row = await submit(db, merchantId, creds.wabaId, creds.token, def.base, def, null, 'template_submit');
    if (row) out.push(row);
  }
  return out;
}

/**
 * Resubmit a rejected template under a new name (`_v2`, `_v3`…): Meta refuses the same name for
 * 30 days after a rejection. The kind is the base name; the newest version is what gets sent.
 */
export async function resubmitTemplate(db: SupabaseClient, ctx: { merchantId: string; memberId?: string }, kind: string): Promise<TemplateRow | null> {
  const def = TEMPLATE_DEFS[kind as TemplateKind];
  if (!def) return null;
  const creds = await wabaAndToken(db, ctx.merchantId);
  if (!creds) return null;
  const versions = (await listTemplates(db, ctx.merchantId)).filter((t) => t.name === def.base || t.name.startsWith(`${def.base}_v`));
  const next = `${def.base}_v${versions.length + 1}`;
  return submit(db, ctx.merchantId, creds.wabaId, creds.token, next, def, ctx, 'template_resubmit');
}

/** `message_template_status_update` → the row, plus a notification when the merchant must act. */
export async function applyTemplateStatus(db: SupabaseClient, ev: AccountEvent): Promise<void> {
  const v = ev.value as { event?: string; message_template_id?: string | number; message_template_name?: string; reason?: string };
  const status = templateStatusFromEvent(v.event);
  if (!status || !v.message_template_name) return;
  const { data: rows } = await db
    .from('message_templates')
    .update({ status, rejection_reason: status === 'rejected' || status === 'paused' ? v.reason ?? null : null, ...(v.message_template_id ? { wa_template_id: String(v.message_template_id) } : {}) })
    .match({ waba_id: ev.wabaId, name: v.message_template_name })
    .select('merchant_id, name');
  if (!rows?.length) {
    logger.info({ wabaId: ev.wabaId, name: v.message_template_name, status }, 'template status for a template we do not hold');
    return;
  }
  if (status !== 'rejected' && status !== 'paused' && status !== 'disabled') return;
  for (const r of rows) {
    await notify(db, r.merchant_id, {
      type: 'template_status',
      title: `Template ${r.name} ${status}`,
      body: v.reason ? `Meta's reason: ${v.reason}. Resubmit it from Settings → WhatsApp.` : 'Resubmit it from Settings → WhatsApp.',
      data: { action: 'template_status', template: r.name, status, reason: v.reason ?? null },
    });
  }
}
