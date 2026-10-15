'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CreditCard, Landmark, Send } from 'lucide-react';
import AppShell, { PageHead, Pill, humanize } from '../../components/AppShell';
import { api, apiError, apiJson, dt, rs } from '../../lib/api';
import { useToast } from '../../components/Toast';

/** The merchant's billing page (SRS P7, FR-P7.4): plan, dates, usage, invoices, "I've paid", plan request. */

interface Billing {
  plan: 'pilot' | 'basic' | 'pro';
  subscription: { status: string; trialEndsAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; requestedPlan: string | null } | null;
  limits: { conversations: number };
  usage: { month: string; conversations: number; outbound: number; freeQuota: number };
  mode: 'sell' | 'handoff' | 'off';
  reason: 'suspended' | 'bot_off' | 'past_due' | 'limit' | null;
  invoices: { id: string; plan: string; period_start: string; period_end: string; amount_paisa: number; status: string; reference: string | null; claimed_at: string | null; paid_at: string | null }[];
  plans: { id: 'pilot' | 'basic' | 'pro'; label: string; conversations: number; pricePaisa: number }[];
  bankDetails: string;
}

const tone = (s: string) => (s === 'active' || s === 'trial' || s === 'paid' ? 'success' : s === 'past_due' || s === 'due' ? 'warning' : s === 'expired' ? 'danger' : 'neutral');

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div className="mt-2">
      <div className="row between"><span className="strong">{label}</span><span className="muted">{used.toLocaleString('en-PK')} of {limit.toLocaleString('en-PK')}</span></div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label} style={{ height: 8, borderRadius: 4, background: 'var(--surface)', marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--brand)' }} />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const toast = useToast();
  const [b, setB] = useState<Billing | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [want, setWant] = useState<'basic' | 'pro'>('basic');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiJson<Billing>('/api/v1/admin/billing').then(setB).catch(() => toast('Could not load billing', 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  async function claim(id: string) {
    setBusy(true);
    const r = await api(`/api/v1/admin/invoices/${id}/claim`, { method: 'POST', body: JSON.stringify({ reference: refs[id] ?? '' }) });
    setBusy(false);
    if (r.ok) { toast('Reference sent. We confirm within one working day.', 'success'); load(); } else toast(await apiError(r), 'error');
  }
  async function request() {
    setBusy(true);
    const r = await api('/api/v1/admin/subscription/request', { method: 'POST', body: JSON.stringify({ plan: want }) });
    setBusy(false);
    if (r.ok) { toast('Request sent', 'success'); load(); } else toast(await apiError(r), 'error');
  }

  if (!b) return <AppShell><div className="skeleton" style={{ height: 40, width: 220, marginBottom: 20 }} /><div className="skeleton" style={{ height: 200 }} /></AppShell>;
  const plan = b.plans.find((p) => p.id === b.plan)!;
  const s = b.subscription;
  const due = b.invoices.filter((i) => i.status === 'due');

  return (
    <AppShell>
      <PageHead title="Billing" sub="Your plan, this month's usage and invoices. Paid by bank transfer; nothing is charged automatically." />

      {b.mode === 'handoff' && (
        <div className="callout" role="status">
          <div className="row no-wrap-row">
            <div className="ico"><AlertTriangle aria-hidden /></div>
            <div>
              <div className="strong">{b.reason === 'limit' ? 'This month\'s conversation allowance is used up' : 'The bot is handing chats to you until the invoice is paid'}</div>
              <div className="hint">{b.reason === 'limit' ? 'New chats go to your inbox until the month resets, or ask for a bigger plan below.' : 'Nothing is deleted and every message is kept. Pay the invoice below and enter your transfer reference.'}</div>
            </div>
          </div>
        </div>
      )}

      <div className="split">
        <div className="card pad">
          <div className="row between mb-1">
            <h2 className="m0 row gap-1"><CreditCard aria-hidden /> {plan.label} plan</h2>
            {s && <Pill kind={tone(s.status)}>{humanize(s.status)}</Pill>}
          </div>
          <div className="hint">
            {plan.pricePaisa ? `${rs(plan.pricePaisa)} a month` : 'Free'} · up to {plan.conversations.toLocaleString('en-PK')} conversations a month
            {s?.status === 'trial' && s.trialEndsAt && <> · free until {dt(s.trialEndsAt)}</>}
            {s?.status === 'active' && s.currentPeriodEnd && <> · paid until {dt(s.currentPeriodEnd)}</>}
          </div>
          <Meter label={`Conversations in ${b.usage.month}`} used={b.usage.conversations} limit={b.limits.conversations} />
          <Meter label="WhatsApp messages sent (free allowance)" used={b.usage.outbound} limit={b.usage.freeQuota} />
          <div className="divider" />
          <div className="form-row">
            <div className="field"><label htmlFor="want">Change plan</label>
              <select id="want" value={want} onChange={(e) => setWant(e.target.value as 'basic' | 'pro')}>
                {b.plans.filter((p) => p.id !== 'pilot').map((p) => <option key={p.id} value={p.id}>{p.label}: {rs(p.pricePaisa)} a month, {p.conversations.toLocaleString('en-PK')} chats</option>)}
              </select>
            </div>
            <button className="btn ghost" onClick={request} disabled={busy || want === b.plan}><Send aria-hidden /> Ask for this plan</button>
          </div>
          {s?.requestedPlan && <div className="hint">Requested: {humanize(s.requestedPlan)}. We apply it and confirm by notification.</div>}
        </div>

        <div className="card pad">
          <h2 className="m0 row gap-1"><Landmark aria-hidden /> How to pay</h2>
          <p className="hint mt-1">Transfer the invoice amount to the account below, then enter the transfer reference next to the invoice. We mark it paid by hand, usually within one working day.</p>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface)', padding: 12, borderRadius: 8, fontSize: 13 }}>{b.bankDetails || 'Bank details will appear here once set. Contact support.'}</pre>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-head"><div><h2>Invoices</h2><div className="desc">{due.length ? `${due.length} due` : 'Nothing due'}</div></div></div>
        {b.invoices.length === 0 ? <div className="pad hint">No invoices yet. Your first one arrives seven days before the free pilot ends.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Plan</th><th className="num">Amount</th><th>Status</th><th>Transfer reference</th></tr></thead>
              <tbody>
                {b.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="nowrap">{dt(i.period_start)} to {dt(i.period_end)}</td>
                    <td>{humanize(i.plan)}</td>
                    <td className="num strong">{rs(i.amount_paisa)}</td>
                    <td><Pill kind={tone(i.status)}>{i.status}</Pill>{i.paid_at && <div className="hint">{dt(i.paid_at)}</div>}</td>
                    <td>
                      {i.status === 'due' ? (
                        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <label htmlFor={`ref-${i.id}`} className="sr-only">Transfer reference</label>
                          <input id={`ref-${i.id}`} className="mono" maxLength={80} placeholder={i.reference ?? 'e.g. TRX 12345678'} value={refs[i.id] ?? ''} onChange={(e) => setRefs({ ...refs, [i.id]: e.target.value })} style={{ width: 180 }} />
                          <button className="btn sm" disabled={busy || !(refs[i.id] ?? '').trim()} onClick={() => claim(i.id)}>I&apos;ve paid</button>
                        </div>
                      ) : <span className="mono">{i.reference ?? '—'}</span>}
                      {i.status === 'due' && i.reference && <div className="hint">Sent: {i.reference}, awaiting confirmation</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
