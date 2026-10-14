'use client';
import { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import AppShell, { EmptyState, PageHead, Pill } from '../../../components/AppShell';
import { apiJson, dt } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { ago } from '../../../components/ConsoleParts';

/**
 * Job heartbeats (F1): one `job_runs` row per background job, overwritten on every run. Reworked
 * after the 2026-10-14 critique: the jobs are named for what they do, times are relative and stay
 * current (the page refreshes itself), and a failure says what happens next.
 */

interface Job { job: string; interval_seconds: number; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; summary: Record<string, unknown> | null }

const JOBS: Record<string, { name: string; does: string; unit: Record<string, string> }> = {
  replay_sweeper: { name: 'Missed-message replay', does: 'Answers buyer messages a crash or redeploy left unanswered.', unit: {} },
  retention: { name: 'Data retention', does: 'Deletes old logs and decided payment screenshots, as the privacy policy promises.', unit: { screenshots: 'screenshot deleted|screenshots deleted', webhook_events: 'old webhook log dropped|old webhook logs dropped', messages_raw: 'raw message copy cleared|raw message copies cleared' } },
  unpaid_expiry: { name: 'Unpaid-order expiry', does: 'Cancels bank-transfer orders with no screenshot after the shop’s hours, and puts the stock back.', unit: { cancelled: 'order expired|orders expired' } },
  billing: { name: 'Billing', does: 'Sends trial-ending notices and invoices, and hands chats over when an invoice is overdue.', unit: { warned: 'trial notice|trial notices', invoiced: 'invoice sent|invoices sent', pastDue: 'shop moved to overdue|shops moved to overdue' } },
};
/** 60 → "every minute", 3600 → "hourly", 21600 → "every 6 h". */
const every = (s: number) => (s <= 60 ? 'every minute' : s < 3600 ? `every ${Math.round(s / 60)} min` : s === 3600 ? 'hourly' : `every ${Math.round(s / 3600)} h`);
const REFRESH_MS = 60_000;

function summary(j: Job): string {
  const parts = Object.entries(j.summary ?? {})
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([k, v]) => {
      const [one, many] = (JOBS[j.job]?.unit[k] ?? k.replace(/_/g, ' ')).split('|');
      return `${(v as number).toLocaleString('en-PK')} ${v === 1 ? one : many ?? one}`;
    });
  return parts.length ? parts.join(' · ') : 'Nothing to do last time';
}

function Result({ j, now }: { j: Job; now: number }) {
  if (j.ok === true) return <Pill kind="success">Worked</Pill>;
  if (j.ok === false) return <><Pill kind="danger">Failed</Pill><div className="hint" style={{ marginTop: 4 }}>{(j.error ?? 'No error text').replace(/[.\s]*$/, '.')} It runs again {every(j.interval_seconds)}; if it keeps failing, read the backend logs on Railway.</div></>;
  if (j.finished_at == null) {
    const overdue = now - new Date(j.started_at).getTime() > 2 * j.interval_seconds * 1000;
    return overdue
      ? <><Pill kind="danger">Stuck</Pill><div className="hint" style={{ marginTop: 4 }}>Started {ago(j.started_at, now)} and never finished. A restart or redeploy usually interrupted it; check the backend logs if it stays stuck.</div></>
      : <Pill kind="info">Running now</Pill>;
  }
  return <Pill kind="neutral">Unknown</Pill>;
}

export default function PlatformJobs() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => apiJson<{ jobs: Job[] }>('/api/v1/platform/jobs')
    .then((r) => { setJobs(r.jobs); setNow(Date.now()); })
    .catch((e) => { setJobs((cur) => cur ?? []); toast((e as Error).message, 'error'); }), [toast]);
  useEffect(() => {
    load();
    // Stay current without a reload: re-read every minute, re-count "ago" every 15 s.
    const r = setInterval(load, REFRESH_MS);
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(r); clearInterval(t); };
  }, [load]);

  return (
    <AppShell variant="platform">
      <PageHead title="Jobs" sub="The four background jobs and how each last ran. This page refreshes itself." />
      <div className="card">
        {jobs && jobs.length === 0 && <EmptyState icon={Timer} title="No job has run yet" hint="Jobs run only on the production backend, so a local copy shows nothing here." />}
        {jobs && jobs.length > 0 && (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Job</th><th>Last run</th><th>Result</th><th>Last time it</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.job}>
                    <td data-label="Job"><span className="strong">{JOBS[j.job]?.name ?? j.job}</span><div className="hint">{JOBS[j.job]?.does ?? ''} Runs {every(j.interval_seconds)}.</div></td>
                    <td data-label="Last run" style={{ whiteSpace: 'nowrap' }} title={`Started ${dt(j.started_at, true)}${j.finished_at ? `, finished ${dt(j.finished_at, true)}` : ''}`}>{ago(j.started_at, now)}</td>
                    <td data-label="Result" style={{ maxWidth: 360 }}><Result j={j} now={now} /></td>
                    <td data-label="Last time it" className="hint">{j.ok === true ? summary(j) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!jobs && <div className="skeleton" style={{ height: 120, margin: 16 }} />}
      </div>
    </AppShell>
  );
}
