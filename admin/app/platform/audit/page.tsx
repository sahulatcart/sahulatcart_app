'use client';
import { Fragment, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ScrollText } from 'lucide-react';
import AppShell, { EmptyState, PageHead, humanize } from '../../../components/AppShell';
import { apiJson, dt, rs } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { ago } from '../../../components/ConsoleParts';

/**
 * A reader for `audit_log` (F1): newest first, filtered by shop and action, paged by `nextBefore`.
 * Reworked after the 2026-10-14 critique: filters apply as they change, the action filter offers the
 * actions it knows (so nobody has to remember `platform_view`), and changes read as words, not JSON.
 */

interface Row { id: string; merchant_id: string | null; businessName: string | null; actor: string; user_id: string | null; action: string; entity: string; entity_id: string | null; diff: unknown; created_at: string }
interface Shop { id: string; businessName: string }
interface Filters { merchantId: string; action: string }

const PAGE = 50;
/** The actions the backend writes today, with the words the founders use. A new one still shows, humanized. */
const ACTIONS: Record<string, string> = {
  platform_view: 'Founder looked inside a shop',
  suspend: 'Shop suspended',
  unsuspend: 'Suspension lifted',
  plan_changed: 'Plan changed',
  plan_change_requested: 'Owner asked for a plan',
  invoice_paid: 'Invoice marked paid',
  platform_admin_added: 'Platform admin added',
  platform_admin_removed: 'Platform admin removed',
  signup_settings_changed: 'Sign-up settings changed',
  purge_logs: 'Old logs purged',
  purge_payment_screenshots: 'Old payment screenshots purged',
};
const ACTOR: Record<string, string> = { platform: 'Founder', merchant: 'Shop', system: 'System' };
const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** One change, readable: money in rupees, timestamps in Pakistan time, everything else as written. */
function value(key: string, v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number' && /paisa$/.test(key)) return rs(v);
  if (typeof v === 'string' && ISO.test(v)) return dt(v, true);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function Diff({ d }: { d: unknown }) {
  if (d == null || typeof d !== 'object' || Object.keys(d as object).length === 0) return <span className="hint">—</span>;
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 13 }}>
      {Object.entries(d as Record<string, unknown>).map(([k, v]) => (
        <Fragment key={k}><dt className="muted">{humanize(k.replace(/_paisa$/, ''))}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value(k, v)}</dd></Fragment>
      ))}
    </dl>
  );
}

function AuditInner() {
  const toast = useToast();
  const params = useSearchParams();
  const initialMerchant = params.get('merchantId') ?? '';
  const [shops, setShops] = useState<Shop[]>([]);
  const [applied, setApplied] = useState<Filters>({ merchantId: initialMerchant, action: '' });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback(async (f: Filters, before: string | null) => {
    const q = new URLSearchParams();
    if (f.merchantId) q.set('merchantId', f.merchantId);
    if (f.action) q.set('action', f.action);
    if (before) q.set('before', before);
    q.set('limit', String(PAGE));
    setBusy(true);
    try {
      const r = await apiJson<{ rows: Row[]; nextBefore: string | null }>(`/api/v1/platform/audit?${q}`);
      setRows((cur) => (before && cur ? [...cur, ...r.rows] : r.rows));
      setNextBefore(r.nextBefore);
    } catch (e) {
      if (!before) setRows([]);
      toast((e as Error).message, 'error');
    }
    setBusy(false);
  }, [toast]);

  useEffect(() => {
    apiJson<{ merchants: Shop[] }>('/api/v1/platform/merchants').then((r) => setShops(r.merchants)).catch(() => setShops([]));
  }, []);
  useEffect(() => { setRows(null); query(applied, null); }, [applied, query]);

  const filtered = !!(applied.merchantId || applied.action);

  return (
    <AppShell variant="platform">
      <PageHead title="Audit" sub="Every recorded action across the platform, newest first" />
      <div className="card">
        <div className="card-head">
          <div className="form-row" style={{ flex: 1 }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="audit-shop">Shop</label>
              <select id="audit-shop" value={applied.merchantId} onChange={(e) => setApplied((f) => ({ ...f, merchantId: e.target.value }))}>
                <option value="">All shops</option>
                {shops.map((s) => <option key={s.id} value={s.id}>{s.businessName}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 220px' }}>
              <label htmlFor="audit-action">What happened</label>
              <select id="audit-action" value={applied.action} onChange={(e) => setApplied((f) => ({ ...f, action: e.target.value }))}>
                <option value="">Anything</option>
                {Object.entries(ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            {filtered && <button type="button" className="btn subtle" onClick={() => setApplied({ merchantId: '', action: '' })}>Clear filters</button>}
          </div>
        </div>
        {rows && rows.length === 0 && <EmptyState icon={ScrollText} title="Nothing recorded" hint={filtered ? 'No entries match these filters.' : 'Actions appear here as founders, shops and jobs make them.'} />}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>When</th><th>What happened</th><th>Shop</th><th>By</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="When" style={{ whiteSpace: 'nowrap' }} title={dt(r.created_at, true)}>{ago(r.created_at)}</td>
                    <td data-label="What happened"><span className="strong">{ACTIONS[r.action] ?? humanize(r.action)}</span><div className="hint">{humanize(r.entity)}{r.entity_id && <> <span className="mono">{r.entity_id.slice(0, 8)}</span></>}</div></td>
                    <td data-label="Shop">{r.merchant_id ? <Link href={`/platform/shops/${r.merchant_id}`} className="link">{r.businessName ?? r.merchant_id.slice(0, 8)}</Link> : <span className="hint">Platform</span>}</td>
                    <td data-label="By">{ACTOR[r.actor] ?? humanize(r.actor ?? 'unknown')}{r.user_id && <div className="mono hint" title={r.user_id}>{r.user_id.slice(0, 8)}</div>}</td>
                    <td data-label="Details" style={{ minWidth: 220 }}><Diff d={r.diff} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && nextBefore && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => query(applied, nextBefore)}><ChevronDown aria-hidden /> {busy ? 'Loading…' : 'Load older'}</button>
          </div>
        )}
        {!rows && <div className="skeleton" style={{ height: 120, margin: 16 }} />}
      </div>
    </AppShell>
  );
}

export default function PlatformAudit() {
  return (
    <Suspense fallback={<AppShell variant="platform"><PageHead title="Audit" /><div className="card"><div className="skeleton" style={{ height: 120, margin: 16 }} /></div></AppShell>}>
      <AuditInner />
    </Suspense>
  );
}
