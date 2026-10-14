'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpCircle, Receipt, Store, Timer } from 'lucide-react';
import AppShell, { EmptyState, PageHead } from '../../components/AppShell';
import { apiJson, rs } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { ago, changePlan, ChangePlanDialog, day, MarkPaidDialog, phone, SellingBadge, sellingRank, type DueInvoice, type PlanOption, type Selling } from '../../components/ConsoleParts';

/**
 * The founders' console, Shops (2026-10-14 critique): answers "who is broken, who owes us" first.
 * Every shop's whole state sits in its own row; the row carries only the money action. Suspending
 * and changing a plan live on the shop page, behind a dialog, never one click from a list.
 */

interface Merchant {
  id: string; businessName: string; ownerEmail: string | null; phone: string | null; status: string; plan: string; createdAt: string;
  connection: { status: string; phone?: string | null; quality?: string | null; flagReason?: string | null };
  lastInboundAt: string | null; ordersThisMonth: number; outboundThisMonth: number;
  suspension: { reason?: string; at?: string; by?: string } | null;
  selling: Selling;
  subscription: { status: string; plan: string; requestedPlan: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
  dueInvoice: DueInvoice | null;
}
interface Job { job: string; interval_seconds: number; started_at: string; finished_at: string | null; ok: boolean | null }
type Filter = 'all' | 'not_selling' | 'money' | 'requests';

const planLabel = (plans: PlanOption[], id: string) => plans.find((p) => p.id === id)?.label ?? id;
/** Problems first: broken bots, then money waiting on us (claimed before unclaimed), then plan requests, then the rest by last message. */
function rank(m: Merchant): number {
  if (!m.selling.selling && sellingRank(m.selling) === 0) return 0;
  if (m.dueInvoice?.reference) return 1;
  if (m.dueInvoice) return 2;
  if (m.subscription?.requestedPlan) return 3;
  return 4 + sellingRank(m.selling);
}
const jobFailing = (j: Job, now: number) => j.ok === false || (j.finished_at == null && now - new Date(j.started_at).getTime() > 2 * j.interval_seconds * 1000);

export default function PlatformShops() {
  const toast = useToast();
  const [rows, setRows] = useState<Merchant[] | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [month, setMonth] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [flash, setFlash] = useState<string | null>(null);
  const [paying, setPaying] = useState<Merchant | null>(null);
  const [planFor, setPlanFor] = useState<Merchant | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(() => apiJson<{ month: string; merchants: Merchant[]; plans: PlanOption[] }>('/api/v1/platform/merchants')
    .then((r) => { setRows(r.merchants); setMonth(r.month); setPlans(r.plans ?? []); })
    .catch((e) => { setRows((cur) => cur ?? []); toast((e as Error).message, 'error'); }), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiJson<{ jobs: Job[] }>('/api/v1/platform/jobs').then((r) => setJobs(r.jobs)).catch(() => setJobs([])); }, []);
  // "/" jumps to search from anywhere on the page; Esc clears it.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo(() => rows ?? [], [rows]);
  const counts = useMemo(() => ({
    notSelling: all.filter((m) => !m.selling.selling).length,
    due: all.filter((m) => m.dueInvoice).length,
    claimed: all.filter((m) => m.dueInvoice?.reference).length,
    requests: all.filter((m) => m.subscription?.requestedPlan).length,
  }), [all]);
  const failingJobs = jobs.filter((j) => jobFailing(j, Date.now())).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((m) => filter === 'all' || (filter === 'not_selling' && !m.selling.selling) || (filter === 'money' && m.dueInvoice) || (filter === 'requests' && m.subscription?.requestedPlan))
      .filter((m) => !needle || `${m.businessName} ${m.ownerEmail ?? ''} ${m.phone ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || (b.lastInboundAt ?? '').localeCompare(a.lastInboundAt ?? ''));
  }, [all, q, filter]);

  const changed = (id: string) => { setFlash(id); setTimeout(() => setFlash((f) => (f === id ? null : f)), 1700); };
  const chip = (id: Filter, label: string, n: number, tone = '') => (
    <button type="button" className={`chip ${tone}`} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? 'all' : id)}>
      {label} <span className="n">{n}</span>
    </button>
  );

  return (
    <AppShell variant="platform">
      <PageHead title="Shops" sub={`Every shop on Sahulatcart${month ? ` · ${month}` : ''}`}
        action={(
          <div className="search">
            <label htmlFor="q" className="sr-only">Search shops by name, email or phone</label>
            <input id="q" ref={search} type="search" placeholder="Search shops" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} style={{ width: 240 }} />
            {!q && <span className="kbd" aria-hidden>/</span>}
          </div>
        )} />

      {rows && rows.length > 0 && (
        <div className="attention" role="group" aria-label="Show only">
          {chip('all', 'All shops', all.length)}
          {chip('not_selling', 'Not selling', counts.notSelling, counts.notSelling ? 'danger' : '')}
          {chip('money', counts.claimed ? `Invoices due (${counts.claimed} claimed)` : 'Invoices due', counts.due, counts.due ? 'warning' : '')}
          {chip('requests', 'Plan requests', counts.requests)}
          {failingJobs > 0 && <Link href="/platform/jobs" className="chip danger"><Timer aria-hidden /> {failingJobs} job{failingJobs === 1 ? '' : 's'} failing</Link>}
        </div>
      )}

      <div className="card">
        {rows && rows.length === 0 && <EmptyState icon={Store} title="No shops yet" hint="Shops appear here as merchants sign up. Open sign-up, or add emails to the allow-list, under Access." action={<Link href="/platform/access" className="btn ghost sm">Open Access</Link>} />}
        {rows && rows.length > 0 && shown.length === 0 && (
          <div className="empty"><div className="display">No shop matches</div><div className="hint">{q ? `Nothing for “${q}”.` : 'Nothing under this filter right now.'}</div><div className="action"><button type="button" className="btn ghost sm" onClick={() => { setQ(''); setFilter('all'); }}>Show all shops</button></div></div>
        )}
        {shown.length > 0 && (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Shop</th><th>Bot</th><th>Billing</th><th><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {shown.map((m) => {
                  const inv = m.dueInvoice;
                  const req = m.subscription?.requestedPlan;
                  return (
                    <tr key={m.id} className={flash === m.id ? 'flash' : undefined}>
                      <td data-label="Shop">
                        <Link href={`/platform/shops/${m.id}`} className="strong link">{m.businessName}</Link>
                        <div className="hint">{m.ownerEmail ?? '—'}</div>
                        <div className="hint"><span className="mono">{phone(m.phone)}</span></div>
                        <div className="hint">{m.lastInboundAt ? `Last message ${ago(m.lastInboundAt)}` : 'No messages yet'} · {m.ordersThisMonth} order{m.ordersThisMonth === 1 ? '' : 's'} this month</div>
                      </td>
                      <td data-label="Bot" style={{ minWidth: 190 }}><SellingBadge s={m.selling} /></td>
                      <td data-label="Billing">
                        <div><span className="strong">{planLabel(plans, m.plan)}</span>{m.subscription?.status === 'trial' && m.subscription.trialEndsAt ? <span className="hint"> · trial to {day(m.subscription.trialEndsAt)}</span> : m.subscription?.currentPeriodEnd && !inv ? <span className="hint"> · paid to {day(m.subscription.currentPeriodEnd)}</span> : null}</div>
                        {inv && (
                          <div className="hint" style={{ color: inv.reference ? 'var(--ink-2)' : 'var(--warning)' }}>
                            <span style={{ whiteSpace: 'nowrap' }}><Receipt size={13} aria-hidden style={{ verticalAlign: -2 }} /> Owes {rs(inv.amountPaisa)}</span>
                            <span style={{ display: 'block' }}>{inv.reference ? <>Claimed <span className="mono">{inv.reference}</span> · {ago(inv.claimedAt)}</> : 'Not claimed yet'}</span>
                          </div>
                        )}
                        {req && <div className="hint"><ArrowUpCircle size={13} aria-hidden style={{ verticalAlign: -2 }} /> Asked for {planLabel(plans, req)}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {inv
                          ? <button type="button" className={inv.reference ? 'btn sm' : 'btn ghost sm'} onClick={() => setPaying(m)} aria-label={`Mark ${rs(inv.amountPaisa)} from ${m.businessName} paid`}>{inv.reference ? 'Mark paid' : 'Mark paid…'}</button>
                          : req
                            ? <button type="button" className="btn ghost sm" onClick={() => setPlanFor(m)} aria-label={`Review ${m.businessName}'s request for ${planLabel(plans, req)}`}>Apply {planLabel(plans, req)}…</button>
                            : !m.selling.selling && m.selling.code !== 'bot_off' && m.selling.code !== 'suspended'
                              ? <Link href={`/platform/shops/${m.id}`} className="btn ghost sm" aria-label={`Open ${m.businessName} to see what is wrong`}>Open shop</Link>
                              : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!rows && <div className="skeleton" style={{ height: 160, margin: 16 }} />}
      </div>

      <MarkPaidDialog open={!!paying} shop={paying?.businessName ?? ''} invoice={paying?.dueInvoice ?? null} onClose={() => setPaying(null)}
        onDone={() => { const m = paying!; setPaying(null); toast(`${rs(m.dueInvoice!.amountPaisa)} from ${m.businessName} marked paid`, 'success'); changed(m.id); load(); }} />
      {planFor && (
        <ChangePlanDialog open={!!planFor} shop={planFor.businessName} merchantId={planFor.id} current={planFor.plan} requested={planFor.subscription?.requestedPlan} plans={plans} onClose={() => setPlanFor(null)}
          onDone={(prev, next) => {
            const m = planFor; setPlanFor(null); changed(m.id); load();
            toast(`${m.businessName} is now on ${planLabel(plans, next)}`, 'success', { label: 'Undo', onClick: async () => { const e = await changePlan(m.id, prev); if (e) toast(e, 'error'); else { toast(`${m.businessName} is back on ${planLabel(plans, prev)}`, 'info'); changed(m.id); load(); } } });
          }} />
      )}
    </AppShell>
  );
}
