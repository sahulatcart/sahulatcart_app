import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { LlmUnavailableError } from '../llm/types';
import { logger } from './logger';

/**
 * The message meter and the AI budget (SRS-Fazal M5).
 *
 * Since 1 October 2026 every WhatsApp message past FREE_QUOTA a month per number is charged, and a
 * free-form reply inside the 24-hour window counts too. Every successful send (client.ts) and every
 * inbound (webhook.ts) bumps `message_usage` through one atomic RPC. The merchant sees "N of 1,000
 * free used", is told at 80% and 100%, and chooses what happens after (`settings.afterFreeQuota`).
 *
 * One Gemini key serves every shop, so each shop also gets a daily cap on AI calls
 * (`settings.llmDailyCap`): past it the orchestrator takes the existing "AI down" handoff path.
 * The meter is an estimate: Meta counts delivered messages on its own calendar; WhatsApp Manager's
 * figure is authoritative.
 */

export const FREE_QUOTA = 1000;
export const DEFAULT_LLM_DAILY_CAP = 2000;
const WARN_AT = [Math.round(FREE_QUOTA * 0.8), FREE_QUOTA];

const KARACHI = 'Asia/Karachi';
/** 'YYYY-MM' in Pakistan time. */
export const periodMonth = (d = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: KARACHI, year: 'numeric', month: '2-digit' }).format(d);
/** 'YYYY-MM-DD' in Pakistan time. */
export const karachiDate = (d = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: KARACHI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export interface UsageCounts { merchantId: string; outbound: number; inbound: number; llmCalls: number }

/**
 * Count messages (and AI calls) for a number. Never throws: a meter failure must not fail a send.
 * Writes the 80% and 100% notifications at the moment the outbound count crosses them.
 */
export async function bumpUsage(
  db: SupabaseClient,
  phoneNumberId: string,
  delta: { outbound?: number; inbound?: number; llm?: number }
): Promise<UsageCounts | null> {
  const outbound = delta.outbound ?? 0;
  try {
    const { data, error } = await db.rpc('bump_message_usage', {
      p_phone: phoneNumberId,
      p_month: periodMonth(),
      p_outbound: outbound,
      p_inbound: delta.inbound ?? 0,
      p_llm: delta.llm ?? 0,
    });
    if (error) {
      logger.warn({ err: error.message, phoneNumberId }, 'message usage bump failed');
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { merchant_id: string; outbound_count: number; inbound_count: number; llm_calls: number } | undefined;
    if (!row) return null;
    const counts: UsageCounts = { merchantId: row.merchant_id, outbound: row.outbound_count, inbound: row.inbound_count, llmCalls: row.llm_calls };
    if (outbound > 0) {
      const before = counts.outbound - outbound;
      for (const t of WARN_AT) if (before < t && counts.outbound >= t) await warnQuota(db, counts.merchantId, t);
    }
    return counts;
  } catch (e) {
    logger.warn({ err: (e as Error).message, phoneNumberId }, 'message usage bump threw');
    return null;
  }
}

async function warnQuota(db: SupabaseClient, merchantId: string, threshold: number): Promise<void> {
  const full = threshold >= FREE_QUOTA;
  const rate = `Rs ${Math.round(loadConfig().META_UTILITY_RATE_PAISA / 100)}`;
  await db.from('notifications').insert({
    merchant_id: merchantId,
    type: 'system',
    title: full ? 'Free WhatsApp messages used up for this month' : `${Math.round((threshold / FREE_QUOTA) * 100)}% of free WhatsApp messages used`,
    body: full
      ? `Every message from now until the 1st costs about ${rate} (Meta's rate). Settings → Messages lets you keep going or switch the bot to hand-over-only.`
      : `${threshold} of ${FREE_QUOTA} free messages sent this month. After ${FREE_QUOTA}, each one costs about ${rate}.`,
    data: { action: 'usage', threshold, month: periodMonth() },
    channel: 'portal',
  });
}

export interface Usage {
  month: string;
  outbound: number;
  inbound: number;
  freeQuota: number;
  paidOutbound: number;
  ratePaisa: number;
  estimatedCostPaisa: number;
  afterQuota: 'continue' | 'handoff';
  llmCallsToday: number;
  llmDailyCap: number;
}

/** What the merchant sees: this month's totals across the shop's numbers, and the two settings. */
export async function getUsage(db: SupabaseClient, merchantId: string): Promise<Usage> {
  const cfg = loadConfig();
  const month = periodMonth();
  const [{ data: rows }, { data: m }] = await Promise.all([
    db.from('message_usage').select('outbound_count, inbound_count, llm_calls, llm_calls_day').eq('merchant_id', merchantId).eq('period_month', month),
    db.from('merchants').select('settings').eq('id', merchantId).maybeSingle(),
  ]);
  const settings = (m?.settings ?? {}) as { afterFreeQuota?: string; llmDailyCap?: number };
  const today = karachiDate();
  let outbound = 0;
  let inbound = 0;
  let llmCallsToday = 0;
  for (const r of rows ?? []) {
    outbound += r.outbound_count ?? 0;
    inbound += r.inbound_count ?? 0;
    if (String(r.llm_calls_day) === today) llmCallsToday += r.llm_calls ?? 0;
  }
  const paidOutbound = Math.max(0, outbound - FREE_QUOTA);
  return {
    month,
    outbound,
    inbound,
    freeQuota: FREE_QUOTA,
    paidOutbound,
    ratePaisa: cfg.META_UTILITY_RATE_PAISA,
    estimatedCostPaisa: paidOutbound * cfg.META_UTILITY_RATE_PAISA,
    afterQuota: settings.afterFreeQuota === 'handoff' ? 'handoff' : 'continue',
    llmCallsToday,
    llmDailyCap: typeof settings.llmDailyCap === 'number' ? settings.llmDailyCap : DEFAULT_LLM_DAILY_CAP,
  };
}

/** This month's outbound count for one number (the orchestrator's after-quota decision). */
export async function outboundThisMonth(db: SupabaseClient, phoneNumberId: string): Promise<number> {
  const { data } = await db.from('message_usage').select('outbound_count').match({ phone_number_id: phoneNumberId, period_month: periodMonth() }).maybeSingle();
  return data?.outbound_count ?? 0;
}

// ── The AI budget ─────────────────────────────────────────────────────────────

export interface LlmBudget { db: SupabaseClient; phoneNumberId: string; cap: number }
const budget = new AsyncLocalStorage<LlmBudget>();

/** Run `fn` with an AI budget; every chargeLlmCall() inside counts against this number's day. */
export const withLlmBudget = <T>(b: LlmBudget, fn: () => Promise<T>): Promise<T> => budget.run(b, fn);

/**
 * Count one AI call, and refuse (LlmUnavailableError, the existing "AI down" path) once the shop's
 * daily cap is reached. Outside a budget scope (admin actions, tests) it is a no-op.
 */
export async function chargeLlmCall(): Promise<void> {
  const b = budget.getStore();
  if (!b) return;
  const counts = await bumpUsage(b.db, b.phoneNumberId, { llm: 1 });
  if (counts && counts.llmCalls > b.cap) {
    logger.warn({ phoneNumberId: b.phoneNumberId, llmCalls: counts.llmCalls, cap: b.cap }, 'daily AI cap reached');
    throw new LlmUnavailableError(`daily AI cap of ${b.cap} calls reached`);
  }
}
