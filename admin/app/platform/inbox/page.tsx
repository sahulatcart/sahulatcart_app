'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCheck, Inbox } from 'lucide-react';
import AppShell, { EmptyState, PageHead, Pill } from '../../../components/AppShell';
import PlatformTabs from '../../../components/PlatformTabs';
import { api, apiError, apiJson, dt } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

/** U2: the founders' inbox. The four things only founders act on; a row links to where to act. */

interface Row { id: string; kind: 'invoice_claimed' | 'plan_requested' | 'whatsapp_attention' | 'job_failed'; merchant_id: string | null; businessName: string | null; title: string; body: string; data: Record<string, unknown>; read_at: string | null; created_at: string }

const TONE: Record<Row['kind'], 'info' | 'brand' | 'warning' | 'danger'> = { invoice_claimed: 'info', plan_requested: 'brand', whatsapp_attention: 'warning', job_failed: 'danger' };
const LABEL: Record<Row['kind'], string> = { invoice_claimed: 'invoice claimed', plan_requested: 'plan requested', whatsapp_attention: 'WhatsApp', job_failed: 'job failed' };
const target = (r: Row): string => (r.kind === 'job_failed' ? '/platform/jobs' : r.merchant_id ? `/platform/shops/${r.merchant_id}` : '/platform');

export default function PlatformInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiJson<{ notifications: Row[] }>('/api/v1/platform/inbox').then((r) => setRows(r.notifications)).catch((e) => { setRows([]); toast((e as Error).message, 'error'); }), [toast]);
  useEffect(() => { load(); }, [load]);

  async function markAll() {
    setBusy(true);
    const r = await api('/api/v1/platform/inbox/read', { method: 'POST', body: '{}' });
    setBusy(false);
    if (!r.ok) return toast(await apiError(r), 'error');
    window.dispatchEvent(new Event('platform-inbox'));
    load();
  }
  const unread = (rows ?? []).filter((r) => !r.read_at).length;

  return (
    <AppShell>
      <PageHead title="Inbox" sub="Invoice claims, plan requests, WhatsApp numbers in trouble and failed jobs. Emailed to every platform admin as they happen."
        action={<button className="btn ghost sm" onClick={markAll} disabled={busy || unread === 0}><CheckCheck aria-hidden /> Mark all read</button>} />
      <PlatformTabs />
      <div className="card">
        {rows && rows.length === 0 && <EmptyState icon={Inbox} title="Nothing here" hint="Claims, plan requests, WhatsApp flags and job failures land here as they happen." />}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Kind</th><th>What</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dt(r.created_at)}</td>
                    <td><Pill kind={TONE[r.kind]}>{LABEL[r.kind]}</Pill></td>
                    <td><div className={r.read_at ? '' : 'strong'}>{r.title}</div><div className="hint">{r.body}</div></td>
                    <td><Link href={target(r)} className="btn ghost sm">{r.kind === 'job_failed' ? 'Jobs' : r.merchant_id ? 'Open shop' : 'Platform'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!rows && <div className="skeleton" style={{ height: 120, margin: 16 }} />}
      </div>
    </AppShell>
  );
}
