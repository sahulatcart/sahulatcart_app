'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ScrollText, Search } from 'lucide-react';
import AppShell, { EmptyState, PageHead, humanize } from '../../../components/AppShell';
import { apiJson, dt } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

/** A reader for `audit_log` (F1): newest first, filtered by shop and action, paged by `nextBefore`. */

interface Row { id: string; merchant_id: string | null; businessName: string | null; actor: string; user_id: string | null; action: string; entity: string; entity_id: string | null; diff: unknown; created_at: string }
interface Shop { id: string; businessName: string }
interface Filters { merchantId: string; action: string }

const PAGE = 50;
const hasDiff = (d: unknown) => d != null && !(typeof d === 'object' && Object.keys(d as object).length === 0);

function AuditInner() {
  const toast = useToast();
  const params = useSearchParams();
  const initialMerchant = params.get('merchantId') ?? '';
  const [shops, setShops] = useState<Shop[]>([]);
  const [merchantId, setMerchantId] = useState(initialMerchant);
  const [action, setAction] = useState('');
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
  useEffect(() => { query(applied, null); }, [applied, query]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setApplied({ merchantId, action: action.trim() });
  }

  return (
    <AppShell variant="platform">
      <PageHead title="Audit" sub="Every recorded action across the platform, newest first" />
      <div className="card">
        <form className="card-head" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
          <div className="form-row" style={{ flex: 1 }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="audit-shop">Shop</label>
              <select id="audit-shop" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                <option value="">All shops</option>
                {shops.map((s) => <option key={s.id} value={s.id}>{s.businessName}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="audit-action">Action</label>
              <input id="audit-action" placeholder="e.g. platform_view" value={action} onChange={(e) => setAction(e.target.value)} />
            </div>
            <button className="btn ghost" disabled={busy}><Search aria-hidden /> Filter</button>
          </div>
        </form>
        {rows && rows.length === 0 && <EmptyState icon={ScrollText} title="Nothing recorded" hint="No audit rows match these filters." />}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Shop</th><th>Actor</th><th>Action</th><th>Entity</th><th>Diff</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dt(r.created_at)}</td>
                    <td>{r.businessName ?? (r.merchant_id ? <span className="mono">{r.merchant_id}</span> : '—')}</td>
                    <td>{r.actor}{r.user_id && <div className="mono hint">{r.user_id}</div>}</td>
                    <td>{humanize(r.action)}</td>
                    <td>{r.entity}{r.entity_id && <div className="mono hint">{r.entity_id}</div>}</td>
                    <td>{hasDiff(r.diff) ? <code className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(r.diff)}</code> : <span className="hint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && nextBefore && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <button className="btn ghost" disabled={busy} onClick={() => query(applied, nextBefore)}><ChevronDown aria-hidden /> Load more</button>
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
