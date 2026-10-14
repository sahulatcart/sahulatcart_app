'use client';
import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import AppShell, { EmptyState, PageHead, Pill } from '../../../components/AppShell';
import { apiJson, dt } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

/** Job heartbeats (F1): one `job_runs` row per background job, overwritten on every run. */

interface Job { job: string; interval_seconds: number; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; summary: Record<string, unknown> | null }

/** 60 → "1 min", 3600 → "1 h", 21600 → "6 h". */
const every = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

function Result({ j, now }: { j: Job; now: number }) {
  if (j.ok === true) return <Pill kind="success">ok</Pill>;
  if (j.ok === false) return <><Pill kind="danger">failed</Pill>{j.error && <div className="hint">{j.error}</div>}</>;
  if (j.finished_at == null) {
    const overdue = now - new Date(j.started_at).getTime() > 2 * j.interval_seconds * 1000;
    return overdue ? <Pill kind="danger">overdue</Pill> : <Pill kind="info">running</Pill>;
  }
  return <Pill kind="neutral">unknown</Pill>;
}

export default function PlatformJobs() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    apiJson<{ jobs: Job[] }>('/api/v1/platform/jobs')
      .then((r) => { setJobs(r.jobs); setNow(Date.now()); })
      .catch((e) => { setJobs([]); toast((e as Error).message, 'error'); });
  }, [toast]);

  return (
    <AppShell variant="platform">
      <PageHead title="Jobs" sub="The background jobs: replay sweeper, retention, unpaid-order expiry and billing" />
      <div className="card">
        {jobs && jobs.length === 0 && <EmptyState icon={Timer} title="No job has run yet" hint="Jobs run only in production." />}
        {jobs && jobs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Job</th><th>Every</th><th>Last started</th><th>Last finished</th><th>Result</th><th>Summary</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.job}>
                    <td className="mono">{j.job}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{every(j.interval_seconds)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dt(j.started_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dt(j.finished_at)}</td>
                    <td><Result j={j} now={now} /></td>
                    <td><code className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(j.summary ?? {})}</code></td>
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
