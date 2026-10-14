'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, ChevronDown, ChevronUp, Receipt, Search, ShieldCheck, Store } from 'lucide-react';
import AppShell, { EmptyState, PageHead, Pill } from '../../components/AppShell';
import { api, apiError, apiJson, dt, rs } from '../../lib/api';
import { useToast } from '../../components/Toast';

/** The platform owner's console (SRS-Fazal M6): every shop, its connection, a suspend switch. */

interface Merchant {
  id: string; businessName: string; ownerEmail: string | null; phone: string | null; status: string; plan: string; createdAt: string;
  connection: { status: string; phone?: string | null; quality?: string | null; flagReason?: string | null };
  lastInboundAt: string | null; ordersThisMonth: number; outboundThisMonth: number;
  suspension: { reason?: string; at?: string; by?: string } | null;
}
interface Invoice { id: string; merchant_id: string; businessName: string | null; plan: string; period_start: string; period_end: string; amount_paisa: number; reference: string | null; claimed_at: string | null; created_at: string }
interface PlanRequest { id: string; merchant_id: string; businessName: string | null; plan: string; status: string; requested_plan: string }
interface Attempt { id: string; status: string; phone_number_id: string | null; error_code: string | null; error_message: string | null; created_at: string }

const tone = (s: string) => (s === 'connected' ? 'success' : s === 'needs_attention' || s === 'connecting' ? 'warning' : s === 'disconnected' ? 'danger' : 'neutral');

export default function PlatformConsole() {
  const toast = useToast();
  const [rows, setRows] = useState<Merchant[] | null>(null);
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, Attempt[]>>({});
  // P7 (FR-P7.5): due invoices with the merchant's claimed reference, and plan-change requests.
  const [bill, setBill] = useState<{ invoices: Invoice[]; requests: PlanRequest[] } | null>(null);
  const loadBill = useCallback(() => apiJson<{ invoices: Invoice[]; requests: PlanRequest[] }>('/api/v1/platform/invoices').then(setBill).catch(() => setBill({ invoices: [], requests: [] })), []);
  useEffect(() => { loadBill(); }, [loadBill]);
  async function post(url: string, body?: object, ok = 'Done') {
    setBusy(url);
    const r = await api(url, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(null);
    if (!r.ok) toast(await apiError(r), 'error'); else { toast(ok, 'success'); loadBill(); load(q); }
  }
  const markPaid = (i: Invoice) => confirm(`Mark ${rs(i.amount_paisa)} from ${i.businessName ?? i.merchant_id} as received? Their plan runs to ${dt(i.period_end)} and the bot sells again.`) && post(`/api/v1/platform/invoices/${i.id}/paid`, undefined, 'Marked paid');
  const setPlan = (merchantId: string, plan: string) => post(`/api/v1/platform/merchants/${merchantId}/plan`, { plan }, `Plan: ${plan}`);

  const load = useCallback((query = '') => apiJson<{ month: string; merchants: Merchant[] }>(`/api/v1/platform/merchants${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    .then((r) => { setRows(r.merchants); setMonth(r.month); })
    .catch((e) => { setRows([]); toast((e as Error).message, 'error'); }), [toast]);
  useEffect(() => { load(); }, [load]);

  async function act(m: Merchant, action: 'suspend' | 'unsuspend') {
    let body: object | undefined;
    if (action === 'suspend') {
      const reason = window.prompt(`Suspend ${m.businessName}? The bot stops replying and the portal becomes read-only.\n\nReason (shown to the merchant):`);
      if (!reason?.trim()) return;
      body = { reason: reason.trim() };
    }
    setBusy(m.id);
    const r = await api(`/api/v1/platform/merchants/${m.id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) toast(await apiError(r), 'error'); else { toast(action === 'suspend' ? 'Suspended' : 'Active again', 'success'); load(q); }
    setBusy(null);
  }

  async function toggleAttempts(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!attempts[id]) {
      const r = await apiJson<{ attempts: Attempt[] }>(`/api/v1/platform/merchants/${id}/attempts`).catch(() => ({ attempts: [] }));
      setAttempts((a) => ({ ...a, [id]: r.attempts }));
    }
  }

  return (
    <AppShell variant="platform">
      <PageHead title="Platform" sub={`Every shop on Sahulatcart${month ? ` · ${month}` : ''}`}
        action={<form onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ display: 'flex', gap: 6 }}><label htmlFor="q" className="sr-only">Search shops</label><input id="q" placeholder="Search name, email, phone" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn ghost icon-btn" aria-label="Search"><Search /></button></form>} />
      <div className="card">
        {rows && rows.length === 0 && <EmptyState icon={Store} title="No shops" hint="Shops appear here as merchants sign up." />}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Shop</th><th>WhatsApp</th><th className="hide-sm">Last message</th><th className="num">Orders</th><th className="num hide-sm">Messages</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <>
                    <tr key={m.id}>
                      <td><Link href={`/platform/shops/${m.id}`} className="strong link">{m.businessName}</Link><div className="hint">{m.ownerEmail ?? '—'} · <label htmlFor={`plan-${m.id}`} className="sr-only">Plan for {m.businessName}</label><select id={`plan-${m.id}`} value={m.plan} onChange={(e) => setPlan(m.id, e.target.value)} disabled={!!busy} style={{ width: 'auto', padding: '0 4px', fontSize: 12, display: 'inline-block' }}><option value="pilot">pilot</option><option value="basic">basic</option><option value="pro">pro</option></select></div></td>
                      <td><Pill kind={tone(m.connection.status)}>{m.connection.status.replace('_', ' ')}</Pill>{m.connection.phone && <div className="mono hint">+{m.connection.phone}</div>}{m.connection.flagReason && <div className="hint">{m.connection.flagReason}</div>}</td>
                      <td className="hide-sm">{dt(m.lastInboundAt)}</td>
                      <td className="num">{m.ordersThisMonth}</td>
                      <td className="num hide-sm">{m.outboundThisMonth.toLocaleString('en-PK')}</td>
                      <td>{m.status === 'suspended' ? <Pill kind="danger">suspended</Pill> : <Pill kind="success">{m.status}</Pill>}{m.suspension?.reason && <div className="hint">{m.suspension.reason}</div>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {m.status === 'suspended'
                          ? <button className="btn sm ghost" disabled={busy === m.id} onClick={() => act(m, 'unsuspend')}><CheckCircle2 aria-hidden /> Unsuspend</button>
                          : <button className="btn sm danger-ghost" disabled={busy === m.id} onClick={() => act(m, 'suspend')}><Ban aria-hidden /> Suspend</button>}
                        {' '}
                        <button className="btn sm ghost icon-btn" onClick={() => toggleAttempts(m.id)} aria-label={open === m.id ? 'Hide connect attempts' : 'Show connect attempts'} aria-expanded={open === m.id}>{open === m.id ? <ChevronUp /> : <ChevronDown />}</button>
                      </td>
                    </tr>
                    {open === m.id && (
                      <tr key={`${m.id}-attempts`}>
                        <td colSpan={7} style={{ background: 'var(--surface)' }}>
                          <div className="hint" style={{ marginBottom: 6 }}><ShieldCheck size={14} aria-hidden /> Last connect attempts</div>
                          {(attempts[m.id] ?? []).length === 0 && <div className="hint">None.</div>}
                          {(attempts[m.id] ?? []).map((a) => (
                            <div key={a.id} className="hint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              <span>{dt(a.created_at)}</span><span className="mono">{a.status}</span>{a.phone_number_id && <span className="mono">{a.phone_number_id}</span>}{a.error_code && <span>{a.error_code}: {a.error_message}</span>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!rows && <div className="skeleton" style={{ height: 120, margin: 16 }} />}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head"><div><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Receipt aria-hidden /> Invoices</h2><div className="desc">Due invoices and plan requests. Mark paid once the transfer shows in the Nubrix account.</div></div></div>
        {bill && bill.invoices.length === 0 && bill.requests.length === 0 && <div className="pad hint">Nothing due and no requests.</div>}
        {bill && bill.invoices.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Shop</th><th>Period</th><th>Plan</th><th className="num">Amount</th><th>Reference</th><th></th></tr></thead>
              <tbody>
                {bill.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="strong">{i.businessName ?? i.merchant_id}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dt(i.period_start)} to {dt(i.period_end)}</td>
                    <td>{i.plan}</td>
                    <td className="num">{rs(i.amount_paisa)}</td>
                    <td>{i.reference ? <><span className="mono">{i.reference}</span><div className="hint">claimed {dt(i.claimed_at)}</div></> : <span className="hint">not claimed yet</span>}</td>
                    <td><button className="btn sm" disabled={!!busy} onClick={() => markPaid(i)}><CheckCircle2 aria-hidden /> Mark paid</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bill && bill.requests.length > 0 && (
          <div className="pad">
            <div className="hint" style={{ marginBottom: 6 }}>Plan requests</div>
            {bill.requests.map((r) => (
              <div key={r.id} className="row between" style={{ padding: '6px 0' }}>
                <span><span className="strong">{r.businessName ?? r.merchant_id}</span> <span className="hint">{r.plan} → {r.requested_plan}</span></span>
                <button className="btn sm ghost" disabled={!!busy} onClick={() => setPlan(r.merchant_id, r.requested_plan)}>Apply {r.requested_plan}</button>
              </div>
            ))}
          </div>
        )}
        {!bill && <div className="skeleton" style={{ height: 60, margin: 16 }} />}
      </div>
    </AppShell>
  );
}
