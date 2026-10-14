// Job heartbeats (docs/launch/PLATFORM-PANEL-FAZAL.md, F1). One job_runs row per background job,
// upserted at the start and the end of every run, read by the platform console's Jobs tab.
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { notifyPlatform } from './notify';

export type JobName = 'replay_sweeper' | 'retention' | 'unpaid_expiry' | 'billing';
export type JobSummary = Record<string, number | string>;

/** Jobs whose heartbeat write has already failed once this process (the warning is logged once). */
const warned = new Set<JobName>();
/** U2: when each job's failure was last put in the founders' inbox. The sweeper runs every minute; a DB outage would otherwise write sixty rows an hour. */
const reported = new Map<JobName, number>();
const REPORT_EVERY_MS = 60 * 60_000;
/** Tests only. */
export const _resetJobRunsState = (): void => { warned.clear(); reported.clear(); };

async function reportFailure(db: SupabaseClient, job: JobName, error: string): Promise<void> {
  const now = Date.now();
  if (now - (reported.get(job) ?? 0) < REPORT_EVERY_MS) return;
  reported.set(job, now);
  await notifyPlatform(db, { kind: 'job_failed', title: `Job failed: ${job}`, body: error, data: { job } }).catch(() => undefined);
}

/**
 * Heartbeat around one run of a background job. Never throws. A failure to write the row is logged
 * once per process per job and the job still runs: the row is for the Jobs tab, it is not allowed
 * to stop the work — and the table may not exist yet, since a deploy lands before its migration.
 */
export async function runJob(db: SupabaseClient, job: JobName, intervalSeconds: number, fn: () => Promise<JobSummary | void>): Promise<void> {
  const started_at = new Date().toISOString();
  await heartbeat(db, job, { job, interval_seconds: intervalSeconds, started_at, finished_at: null, ok: null, error: null });
  let ok = true;
  let error: string | null = null;
  let summary: JobSummary = {};
  try {
    summary = (await fn()) ?? {};
  } catch (e: unknown) {
    ok = false;
    error = String(e instanceof Error ? e.message : e).slice(0, 500);
    logger.error({ err: error, job }, 'job failed');
    await reportFailure(db, job, error);
  }
  await heartbeat(db, job, { job, interval_seconds: intervalSeconds, started_at, finished_at: new Date().toISOString(), ok, error, summary });
}

async function heartbeat(db: SupabaseClient, job: JobName, row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await db.from('job_runs').upsert(row, { onConflict: 'job' });
    if (error && !warned.has(job)) {
      warned.add(job);
      logger.warn({ err: error.message, job }, 'job heartbeat not recorded (is migration 0020 applied?)');
    }
  } catch (e: unknown) {
    if (!warned.has(job)) {
      warned.add(job);
      logger.warn({ err: String(e), job }, 'job heartbeat not recorded');
    }
  }
}
