// Billing (SRS P7): the trial, the monthly invoice, soft enforcement. Nothing here moves money:
// the merchant pays Nubrix by bank transfer and the platform console marks the invoice paid.
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLANS, type Plan, type SubscriptionStatus } from '@app/shared';
import { loadConfig } from '../config';
import { getServiceClient } from './supabase';
import { logger } from './logger';
import { notify } from './notify';
import { periodMonth } from './usage';

export type BotMode = 'sell' | 'handoff' | 'off';

export interface Subscription {
  id: string;
  merchant_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  trial_warned_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  requested_plan: Plan | null;
}

const DAY = 86_400_000;
const WARN_DAYS = 7;
const GRACE_DAYS = 7;

export const isPlan = (v: unknown): v is Plan => v === 'pilot' || v === 'basic' || v === 'pro';

/** The paid plan a lapsed pilot is invoiced for: pilot has no price, so its first invoice is Basic. */
export const paidPlan = (p: Plan): Plan => (p === 'pilot' ? 'basic' : p);

export function planPricePaisa(plan: Plan): number {
  const cfg = loadConfig();
  return plan === 'pro' ? cfg.PLAN_PRO_PRICE_PAISA : plan === 'basic' ? cfg.PLAN_BASIC_PRICE_PAISA : 0;
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}

/**
 * What the bot may do for this shop (FR-P7.6). Off beats everything; a shop with no subscription
 * row (older than P7) sells, never fail-closed; past_due/expired or a used-up conversation
 * allowance means hand-off only: messages are stored, the merchant replies by hand, nothing is lost.
 */
export function botMode(m: { status?: string | null; settings?: { botEnabled?: boolean } | null }, sub: Pick<Subscription, 'plan' | 'status'> | null, conversationsThisMonth: number): { mode: BotMode; reason: 'suspended' | 'bot_off' | 'past_due' | 'limit' | null } {
  if (m.status === 'suspended') return { mode: 'off', reason: 'suspended' };
  if (m.settings?.botEnabled === false) return { mode: 'off', reason: 'bot_off' };
  if (!sub) return { mode: 'sell', reason: null };
  if (sub.status === 'past_due' || sub.status === 'expired') return { mode: 'handoff', reason: 'past_due' };
  if (conversationsThisMonth >= PLANS[sub.plan].conversations) return { mode: 'handoff', reason: 'limit' };
  return { mode: 'sell', reason: null };
}

/** The first instant of this period month in Pakistan time. */
export const monthStart = (month = periodMonth()): string => new Date(`${month}-01T00:00:00+05:00`).toISOString();

/** shortcut: counts chats touched this month (inbound or a merchant reply) via last_message_at; upgrade to a SQL count of distinct inbound conversation_ids when a shop nears its limit. */
export async function conversationsThisMonth(db: SupabaseClient, merchantId: string): Promise<number> {
  const { count } = await db.from('conversations').select('id', { count: 'exact', head: true }).eq('merchant_id', merchantId).gte('last_message_at', monthStart());
  return count ?? 0;
}

export async function getSubscription(db: SupabaseClient, merchantId: string): Promise<Subscription | null> {
  const { data } = await db.from('subscriptions').select('*').eq('merchant_id', merchantId).maybeSingle();
  return (data as Subscription | null) ?? null;
}

/** The orchestrator's one call per inbound message: may the bot still sell for this shop? */
export async function billingMode(db: SupabaseClient, merchant: { id: string; status?: string | null; settings?: { botEnabled?: boolean } | null }): Promise<ReturnType<typeof botMode>> {
  const sub = await getSubscription(db, merchant.id);
  if (!sub) return { mode: 'sell', reason: null };
  if (sub.status === 'past_due' || sub.status === 'expired') return botMode(merchant, sub, 0);
  return botMode(merchant, sub, await conversationsThisMonth(db, merchant.id));
}

/** FR-P7.2: bootstrap gives every new shop a 30-day trial. Idempotent per merchant. */
export async function ensureTrial(db: SupabaseClient, merchantId: string, now: Date = new Date()): Promise<void> {
  const existing = await db.from('subscriptions').select('id').eq('merchant_id', merchantId).maybeSingle();
  if (existing.data) return;
  await db.from('subscriptions').insert({ merchant_id: merchantId, plan: 'pilot', status: 'trial', trial_ends_at: new Date(now.getTime() + PLANS.pilot.trialDays * DAY).toISOString() });
}

const rs = (paisa: number): string => `Rs ${Math.round(paisa / 100).toLocaleString('en-PK')}`;
const day = (iso: string): string => new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium', timeZone: 'Asia/Karachi' }).format(new Date(iso));

/** One due invoice for the period starting at `from`, unless one exists; the merchant is told how to pay. */
async function createInvoice(db: SupabaseClient, sub: Subscription, from: string): Promise<string | null> {
  const plan = paidPlan(sub.plan);
  const existing = await db.from('invoices').select('id').eq('subscription_id', sub.id).eq('period_start', from).maybeSingle();
  if (existing.data) return null;
  const period_end = addMonths(from, 1);
  const amount_paisa = planPricePaisa(plan);
  const { data, error } = await db.from('invoices').insert({ merchant_id: sub.merchant_id, subscription_id: sub.id, plan, period_start: from, period_end, amount_paisa, status: 'due' }).select('id').single();
  if (error || !data) { logger.error({ err: error?.message, subscriptionId: sub.id }, 'invoice insert failed'); return null; }
  const bank = loadConfig().PLATFORM_BANK_DETAILS;
  await notify(db, sub.merchant_id, {
    type: 'system',
    title: `Invoice due: ${PLANS[plan].label} plan, ${rs(amount_paisa)}`,
    body: `For ${day(from)} to ${day(period_end)}. Transfer ${rs(amount_paisa)} to:\n${bank || '(bank details not set yet; contact support)'}\nThen open Billing and enter your transfer reference.`,
    data: { action: 'invoice_due', invoiceId: data.id },
  });
  return data.id as string;
}

/**
 * The daily billing pass (FR-P7.3, P7.6, P7.7). Idempotent: every step is keyed on a column it sets.
 *  - trial ending in 7 days → one notice (and email through notify()).
 *  - trial over → past_due, first invoice due.
 *  - active, period ending in 7 days → next invoice due.
 *  - active, period over by 7 days with the invoice still due → past_due.
 */
export async function runBillingJob(db: SupabaseClient, now: Date = new Date()): Promise<{ warned: string[]; pastDue: string[]; invoiced: string[] }> {
  const out = { warned: [] as string[], pastDue: [] as string[], invoiced: [] as string[] };
  const nowIso = now.toISOString();
  const soon = new Date(now.getTime() + WARN_DAYS * DAY).toISOString();
  const { data } = await db.from('subscriptions').select('*').in('status', ['trial', 'active']);
  for (const sub of (data ?? []) as Subscription[]) {
    if (sub.status === 'trial' && sub.trial_ends_at) {
      if (sub.trial_ends_at <= nowIso) {
        const inv = await createInvoice(db, sub, sub.trial_ends_at);
        await db.from('subscriptions').update({ status: 'past_due', updated_at: nowIso }).eq('id', sub.id).eq('status', 'trial');
        await notify(db, sub.merchant_id, { type: 'system', title: 'Your free pilot has ended', body: 'The bot now hands every new chat to you until the first invoice is paid. Your customers\' messages are still stored and you can reply by hand. Open Billing to pay.', data: { action: 'trial_ended', invoiceId: inv } });
        out.pastDue.push(sub.id);
        if (inv) out.invoiced.push(inv);
      } else if (sub.trial_ends_at <= soon && !sub.trial_warned_at) {
        await db.from('subscriptions').update({ trial_warned_at: nowIso }).eq('id', sub.id).is('trial_warned_at', null);
        await notify(db, sub.merchant_id, { type: 'system', title: `Your free pilot ends on ${day(sub.trial_ends_at)}`, body: `After that the bot hands new chats to you until the ${PLANS[paidPlan(sub.plan)].label} plan (${rs(planPricePaisa(paidPlan(sub.plan)))} a month) is paid. Nothing is deleted.`, data: { action: 'trial_ending' } });
        out.warned.push(sub.id);
      }
      continue;
    }
    if (sub.status === 'active' && sub.current_period_end) {
      if (sub.current_period_end <= soon) {
        const inv = await createInvoice(db, sub, sub.current_period_end);
        if (inv) out.invoiced.push(inv);
      }
      const graceEnd = new Date(new Date(sub.current_period_end).getTime() + GRACE_DAYS * DAY).toISOString();
      if (graceEnd <= nowIso) {
        const due = await db.from('invoices').select('id').eq('subscription_id', sub.id).eq('status', 'due').limit(1).maybeSingle();
        if (due.data) {
          await db.from('subscriptions').update({ status: 'past_due', updated_at: nowIso }).eq('id', sub.id).eq('status', 'active');
          await notify(db, sub.merchant_id, { type: 'system', title: 'Invoice overdue: the bot is in hand-over mode', body: 'The last invoice is 7 days overdue, so the bot hands every new chat to you. Messages are still stored. Pay and enter the reference in Billing to restore selling.', data: { action: 'past_due', invoiceId: due.data.id } });
          out.pastDue.push(sub.id);
        }
      }
    }
  }
  if (out.warned.length || out.pastDue.length || out.invoiced.length) logger.info(out, 'billing job');
  return out;
}

/** FR-P7.5: the console marks a transfer received: the invoice is paid and the period runs to the invoice's end. */
export async function markInvoicePaid(db: SupabaseClient, invoiceId: string, adminAuthUserId: string | null, now: Date = new Date()): Promise<{ ok: true } | { ok: false; status: 404 | 409; message: string }> {
  const { data: paid } = await db.from('invoices').update({ status: 'paid', paid_at: now.toISOString(), marked_by_platform_admin: adminAuthUserId })
    .match({ id: invoiceId, status: 'due' }).select('id, merchant_id, subscription_id, plan, period_start, period_end, amount_paisa').maybeSingle();
  if (!paid) {
    const any = await db.from('invoices').select('id').eq('id', invoiceId).maybeSingle();
    return any.data ? { ok: false, status: 409, message: 'invoice is not due' } : { ok: false, status: 404, message: 'invoice not found' };
  }
  await db.from('subscriptions').update({ status: 'active', plan: paid.plan, current_period_start: paid.period_start, current_period_end: paid.period_end, updated_at: now.toISOString() }).eq('id', paid.subscription_id);
  await db.from('merchants').update({ plan: paid.plan }).eq('id', paid.merchant_id);
  await db.from('audit_log').insert({ merchant_id: paid.merchant_id, actor: 'platform', user_id: adminAuthUserId, action: 'invoice_paid', entity: 'invoice', entity_id: paid.id, diff: { amount_paisa: paid.amount_paisa, period_end: paid.period_end } });
  await notify(db, paid.merchant_id, { type: 'system', title: 'Payment received, thank you', body: `Your ${PLANS[paid.plan as Plan].label} plan runs until ${day(paid.period_end)}. The bot is selling again.`, data: { action: 'invoice_paid', invoiceId: paid.id } });
  return { ok: true };
}

export function startBillingJob(): void {
  const run = () => { void runBillingJob(getServiceClient()).catch((e: unknown) => logger.error({ err: String(e) }, 'billing job failed')); };
  run();
  setInterval(run, 6 * 60 * 60_000).unref(); // four times a day is plenty for 7-day windows
}
