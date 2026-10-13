// Readiness (SRS P2, FR-P2.1): the seven checks a shop must pass before its bot may be switched
// on. Computed server-side from the data itself, never from a flag the portal sets, so "Go live"
// cannot be clicked past a missing bank account or an unconnected number.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConnectionStatus } from '../whatsapp/connect';
import { phoneDigits } from './phone';
import { codOn } from './validation';

export const READINESS_STEPS = ['profile', 'whatsapp', 'catalog', 'delivery', 'payment', 'persona', 'testOrder'] as const;
export type ReadinessStep = (typeof READINESS_STEPS)[number];

export interface StepResult {
  ok: boolean;
  /** Why it is not ok, in the words the wizard shows. */
  reason?: string;
  /** Something is wrong (a flagged number), not merely not done yet. */
  problem?: boolean;
}

export interface Readiness {
  steps: Record<ReadinessStep, StepResult>;
  ready: boolean;
  failing: ReadinessStep[];
}

/**
 * An order the owner placed themselves counts as the test order once it was placed, whatever
 * happened to it since — a dispatched or delivered test order must not turn the step red again
 * (review P2-8). Only never-placed, cancelled and returned orders do not count.
 */
export const TEST_ORDER_STATUSES = ['confirmed', 'awaiting_payment', 'paid', 'preparing', 'dispatched', 'delivered'];

/** At least one day with opening and closing times (a day marked closed does not count). */
export function hasBusinessHours(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  return Object.values(h as Record<string, unknown>).some(
    (d) => !!d && typeof d === 'object' && typeof (d as { open?: unknown }).open === 'string' && typeof (d as { close?: unknown }).close === 'string',
  );
}

const ok: StepResult = { ok: true };
const no = (reason: string, problem = false): StepResult => ({ ok: false, reason, problem });

export async function computeReadiness(db: SupabaseClient, merchantId: string): Promise<Readiness> {
  const [m, product, zone, bank, wa] = await Promise.all([
    db.from('merchants').select('business_name, phone, category, business_hours, bot_persona, settings').eq('id', merchantId).maybeSingle(),
    db.from('products').select('id').eq('merchant_id', merchantId).eq('is_active', true).gt('price', 0).limit(1).maybeSingle(),
    db.from('delivery_zones').select('id').eq('merchant_id', merchantId).eq('is_serviceable', true).limit(1).maybeSingle(),
    db.from('bank_accounts').select('id').eq('merchant_id', merchantId).eq('is_active', true).limit(1).maybeSingle(),
    getConnectionStatus(db, merchantId),
  ]);
  // testOrder (review P2-10): the owner's customer row by wa_id, then one placed order of theirs — two
  // small lookups instead of every placed order with its customer on each dashboard load.
  const ownerDigits = phoneDigits(m.data?.phone);
  const ownerCust = ownerDigits ? await db.from('customers').select('id').eq('merchant_id', merchantId).eq('wa_id', ownerDigits) : { data: [] as { id: string }[] };
  const ownerIds = (ownerCust.data ?? []).map((c) => c.id as string);
  const ownerOrder = ownerIds.length
    ? await db.from('orders').select('id').eq('merchant_id', merchantId).in('customer_id', ownerIds).in('status', TEST_ORDER_STATUSES).limit(1).maybeSingle()
    : { data: null };
  const row = (m.data ?? {}) as { business_name?: string | null; phone?: string | null; category?: string | null; business_hours?: unknown; bot_persona?: Record<string, unknown> | null; settings?: Record<string, unknown> | null };
  const settings = row.settings ?? {};
  const persona = row.bot_persona ?? {};

  // profile — the shop's own details, plus the two attestations Meta's policies require (FR-P2.9).
  const missing: string[] = [];
  if (!row.business_name?.trim()) missing.push('your shop name');
  if (!row.phone?.trim()) missing.push('your phone number');
  if (!row.category?.trim()) missing.push('a category');
  if (!hasBusinessHours(row.business_hours)) missing.push('your business hours');
  const att = settings.attestations as { noProhibitedGoods?: unknown; optInOnly?: unknown } | undefined;
  if (att?.noProhibitedGoods !== true || att?.optInOnly !== true) missing.push('the two attestations');
  const profile = missing.length ? no(`Add ${missing.join(', ')}`) : ok;

  // whatsapp — IC-4. `connecting` means the handshake is still pending.
  const whatsapp =
    wa.status === 'connected' ? ok
    : wa.status === 'connecting' ? no('Send one message to your shop number from your own phone to finish connecting')
    : wa.status === 'needs_attention' ? no(wa.message ?? 'Your WhatsApp number needs attention', true)
    : wa.status === 'disconnected' ? no('Reconnect your WhatsApp number', true)
    : no('Connect your WhatsApp number');

  const catalog = product.data ? ok : no('Add at least one product with a price');
  const delivery = zone.data || settings.deliveryConfigured === true ? ok : no('Add a delivery area, or set one charge for everywhere');
  const payment = codOn(settings) || bank.data ? ok : no('Turn on cash on delivery, or add a bank account');
  const persona_ = typeof persona.name === 'string' && persona.name.trim() && typeof persona.style === 'string' && persona.style
    ? ok : no('Give your bot a name and a bargaining style');

  const mine = !!ownerOrder.data;
  const testOrder = mine ? ok : no('Place one test order from your own phone, start to finish');

  const steps: Readiness['steps'] = { profile, whatsapp, catalog, delivery, payment, persona: persona_, testOrder };
  const failing = READINESS_STEPS.filter((s) => !steps[s].ok);
  return { steps, ready: failing.length === 0, failing };
}
