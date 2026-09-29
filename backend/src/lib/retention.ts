// Scheduled purges (docs/spec/09 §8.2, CD-41). Production only, hourly — a local backend shares
// the live database through .env and must never delete real data. Each purge that removes
// something writes an audit_log row. Both stay within the privacy policy's maximums (§10).
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from './logger';
import { getServiceClient } from './supabase';

const DAY_MS = 24 * 60 * 60_000;
/** Payment screenshots: days after the claim was decided (verified or rejected). */
export const SCREENSHOT_DAYS = 90;
/** webhook_events rows and messages.raw payloads (the debug window). */
export const LOG_DAYS = 30;

const ago = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();
const audit = (db: SupabaseClient, action: string, diff: Record<string, number>) =>
  db.from('audit_log').insert({ actor: 'system', action, entity: 'retention', diff });

/**
 * Delete payment screenshots whose claim was decided over SCREENSHOT_DAYS ago, then null their
 * references. A claim still awaiting review is never touched, however old. At most 100 per run.
 */
export async function purgeScreenshots(db: SupabaseClient): Promise<number> {
  const { data } = await db
    .from('payment_claims')
    .select('id, screenshot_url')
    .not('screenshot_url', 'is', null)
    .neq('status', 'claimed')
    .lt('decided_at', ago(SCREENSHOT_DAYS))
    .limit(100);
  const rows = (data ?? []) as { id: string; screenshot_url: string }[];
  if (!rows.length) return 0;

  const refs = [...new Set(rows.map((r) => r.screenshot_url))];
  const stored = refs.filter((k) => !k.startsWith('media:')); // "media:" = a Meta media id, never stored by us
  if (stored.length) {
    const { error } = await db.storage.from(loadConfig().STORAGE_BUCKET_PAYMENT_SCREENSHOTS).remove(stored);
    if (error) {
      logger.error({ err: error.message }, 'screenshot purge failed — retrying next run');
      return 0; // references stay until the files are really gone
    }
  }
  await Promise.all([
    db.from('payment_claims').update({ screenshot_url: null }).in('id', rows.map((r) => r.id)),
    db.from('payments').update({ screenshot_url: null }).in('screenshot_url', refs),
  ]);
  await audit(db, 'purge_payment_screenshots', { screenshots: rows.length, older_than_days: SCREENSHOT_DAYS });
  return rows.length;
}

/** Drop webhook_events rows and clear messages.raw after LOG_DAYS. The message text itself stays. */
export async function purgeLogs(db: SupabaseClient): Promise<void> {
  const cutoff = ago(LOG_DAYS);
  const [events, raw] = await Promise.all([
    db.from('webhook_events').delete({ count: 'exact' }).lt('received_at', cutoff),
    db.from('messages').update({ raw: null }, { count: 'exact' }).lt('created_at', cutoff).not('raw', 'is', null),
  ]);
  for (const r of [events, raw]) if (r.error) logger.error({ err: r.error.message }, 'log purge failed');
  if (events.count || raw.count) {
    await audit(db, 'purge_logs', { webhook_events: events.count ?? 0, messages_raw: raw.count ?? 0, older_than_days: LOG_DAYS });
  }
}

/** Run all purges now and every hour after. */
export function startRetentionJob(): void {
  const run = () => {
    const db = getServiceClient();
    void Promise.all([purgeScreenshots(db), purgeLogs(db)]).catch((e: unknown) => logger.error({ err: String(e) }, 'retention job failed'));
  };
  run();
  setInterval(run, 60 * 60_000).unref();
}
