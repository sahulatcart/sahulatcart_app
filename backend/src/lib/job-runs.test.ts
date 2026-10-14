// F1: the job heartbeat. One job_runs row per job, written at start and end; a failing job or a
// failing write never stops the job or throws.
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeDb } from '../test-support/fake-db';
import { runJob, _resetJobRunsState } from './job-runs';

let db: FakeDb;
beforeEach(() => { db = new FakeDb(); _resetJobRunsState(); });

describe('runJob', () => {
  it('a successful run writes one row with ok, finished_at and the summary', async () => {
    await runJob(db.client, 'billing', 21600, async () => ({ warned: 1, pastDue: 0, invoiced: 2 }));
    const rows = db.rows('job_runs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job: 'billing', interval_seconds: 21600, ok: true, error: null, summary: { warned: 1, pastDue: 0, invoiced: 2 } });
    expect(rows[0]!.started_at).toBeTruthy();
    expect(rows[0]!.finished_at >= rows[0]!.started_at).toBe(true);
  });

  it('a job that returns nothing gets an empty summary', async () => {
    await runJob(db.client, 'replay_sweeper', 60, async () => undefined);
    expect(db.rows('job_runs')[0]).toMatchObject({ job: 'replay_sweeper', ok: true, summary: {} });
  });

  it('a throwing job writes ok false and the error, and runJob resolves', async () => {
    await expect(runJob(db.client, 'retention', 3600, async () => { throw new Error('storage down'); })).resolves.toBeUndefined();
    expect(db.rows('job_runs')[0]).toMatchObject({ job: 'retention', ok: false, error: 'storage down', summary: {} });
    expect(db.rows('job_runs')[0]!.finished_at).toBeTruthy();
  });

  it('a second run overwrites the same row instead of adding one', async () => {
    await runJob(db.client, 'unpaid_expiry', 3600, async () => ({ cancelled: 0 }));
    await runJob(db.client, 'unpaid_expiry', 3600, async () => ({ cancelled: 3 }));
    const rows = db.rows('job_runs');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toEqual({ cancelled: 3 });
  });

  it('the start row has finished_at null while the job runs', async () => {
    let seen: unknown;
    await runJob(db.client, 'billing', 21600, async () => { seen = { ...db.rows('job_runs')[0] }; });
    expect(seen).toMatchObject({ job: 'billing', finished_at: null, ok: null });
  });

  it('a client whose upsert fails (table missing before migration 0020) still runs the job and resolves', async () => {
    let ran = 0;
    const broken = { from: () => ({ upsert: async () => ({ data: null, error: { code: '42P01', message: 'relation "job_runs" does not exist' } }) }) } as unknown as SupabaseClient;
    await expect(runJob(broken, 'billing', 21600, async () => { ran++; })).resolves.toBeUndefined();
    await runJob(broken, 'billing', 21600, async () => { ran++; });
    expect(ran).toBe(2);
  });

  it('a client whose upsert throws still runs the job and resolves', async () => {
    let ran = false;
    const broken = { from: () => ({ upsert: async () => { throw new Error('connection refused'); } }) } as unknown as SupabaseClient;
    await expect(runJob(broken, 'retention', 3600, async () => { ran = true; })).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });
});
