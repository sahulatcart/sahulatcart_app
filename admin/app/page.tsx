'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, Clock, Gauge, MessageSquare, ShoppingBag, Sparkles, Wallet } from 'lucide-react';
import AppShell, { EmptyState, PageHead, PaymentPill, StatusPill } from '../components/AppShell';
import { apiJson, rs } from '../lib/api';
import { enablePush, pushState } from '../lib/push';
import { useToast } from '../components/Toast';

interface Usage { month: string; outbound: number; freeQuota: number; paidOutbound: number; ratePaisa: number; estimatedCostPaisa: number; afterQuota: 'continue' | 'handoff'; llmCallsToday: number; llmDailyCap: number }
interface Dash {
  ordersToday: number; revenueToday: number; pendingPayments: number; activeChats: number;
  recentOrders: { id: string; order_number: string; status: string; payment_status: string; total: number; delivery_name: string }[];
}

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  // FR-P2.4: the card shows until every readiness check passes AND the bot is on; it links to the first open step.
  const [setup, setSetup] = useState<{ done: number; next: string | null; ready: boolean } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    apiJson<Dash>('/api/v1/admin/dashboard').then(setD).catch(() => {});
    apiJson<Usage>('/api/v1/admin/usage').then(setUsage).catch(() => {});
    Promise.all([
      apiJson<{ ready: boolean; failing: string[] }>('/api/v1/admin/readiness'),
      apiJson<{ merchant: { settings?: { botEnabled?: boolean } } }>('/api/v1/admin/me'),
    ]).then(([r, me]) => {
      const botOn = me.merchant?.settings?.botEnabled === true;
      setSetup(r.ready && botOn ? null : { done: 7 - r.failing.length, next: r.failing[0] ?? null, ready: r.ready });
    }).catch(() => {});
  }, []);

  const stat = (k: string, v: React.ReactNode, Icon: typeof ShoppingBag, warn = false) => (
    <div className={`stat ${warn ? 'warn' : ''}`}>
      <div className="ico"><Icon aria-hidden /></div>
      <div className="k">{k}</div>
      <div className="v">{d ? v : <span className="skeleton" style={{ display: 'block', height: 32, width: 90 }} />}</div>
    </div>
  );

  return (
    <AppShell>
      <PageHead title="Dashboard" sub="Your shop at a glance — today, in Pakistan time" />

      <PushNudge />
      {setup && (
        <div className="callout">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="ico"><Sparkles aria-hidden /></div>
            <div>
              <div className="strong">{setup.ready ? 'Everything is set — switch the bot on' : 'Finish setting up your shop'}</div>
              <div className="hint">{setup.ready ? 'All seven steps are done. Go live and the bot starts selling.' : `${setup.done} of 7 steps done. The bot stays off until all seven are.`}</div>
            </div>
          </div>
          <Link href={setup.next ? `/onboarding?step=${setup.next}` : '/onboarding'} className="btn">{setup.ready ? 'Go live' : 'Continue setup'} <ArrowRight aria-hidden /></Link>
        </div>
      )}

      <div className="stats">
        {stat("Today's orders", d?.ordersToday, ShoppingBag)}
        {stat("Today's revenue", d && rs(d.revenueToday), Wallet)}
        {stat('Payments to verify', d?.pendingPayments, Clock, !!d?.pendingPayments)}
        {stat('Active chats', d?.activeChats, MessageSquare)}
      </div>

      {usage && (() => {
        const pct = Math.min(100, Math.round((usage.outbound / usage.freeQuota) * 100));
        const tone = usage.outbound >= usage.freeQuota ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--brand)';
        return (
          <div className="card pad" style={{ marginTop: 24 }}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Gauge aria-hidden /> Messages this month</h2>
              <Link href="/settings#messages" className="link" style={{ fontSize: 13 }}>What happens after 1,000 <ArrowRight size={14} aria-hidden /></Link>
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 10 }}>{usage.outbound.toLocaleString('en-PK')} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>of {usage.freeQuota.toLocaleString('en-PK')} free</span></div>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Free messages used" style={{ height: 8, borderRadius: 4, background: 'var(--surface)', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {usage.paidOutbound > 0
                ? `${usage.paidOutbound.toLocaleString('en-PK')} paid messages so far, about ${rs(usage.estimatedCostPaisa)} at Meta's rate of ${rs(usage.ratePaisa)} each. `
                : `After ${usage.freeQuota.toLocaleString('en-PK')}, each message costs about ${rs(usage.ratePaisa)} (Meta's rate; check the current card). `}
              {usage.afterQuota === 'handoff' ? 'Past the free messages the bot hands new chats to you.' : 'Past the free messages the bot keeps selling.'}
              {' '}AI calls today: {usage.llmCallsToday.toLocaleString('en-PK')} of {usage.llmDailyCap.toLocaleString('en-PK')}. This is an estimate; WhatsApp Manager has the exact count.
            </div>
          </div>
        );
      })()}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div><h2>Recent orders</h2><div className="desc">The latest orders placed through the bot</div></div>
          <Link href="/orders" className="btn ghost sm">View all <ArrowRight aria-hidden /></Link>
        </div>
        {d && d.recentOrders.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No orders yet" hint="Share your WhatsApp number with customers to get started." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th className="num">Total</th></tr></thead>
              <tbody>
                {(d?.recentOrders ?? []).map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/orders/${o.id}`} className="link mono">{o.order_number}</Link></td>
                    <td>{o.delivery_name || '—'}</td>
                    <td><StatusPill status={o.status} /></td>
                    <td><PaymentPill status={o.payment_status} /></td>
                    <td className="num strong">{rs(o.total)}</td>
                  </tr>
                ))}
                {!d && [0, 1, 2].map((i) => <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 18 }} /></td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** "Turn on phone notifications" (P3): shown once per device while push is possible but not yet on. */
function PushNudge() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem('sk_push_nudge') === 'off'; } catch { /* storage blocked */ }
    if (dismissed) return;
    pushState().then((st) => setShow(st === 'available')).catch(() => {});
  }, []);
  if (!show) return null;
  async function enable() {
    setBusy(true);
    try { await enablePush(); toast('This device will get alerts for new orders', 'success'); setShow(false); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }
  function later() {
    try { localStorage.setItem('sk_push_nudge', 'off'); } catch { /* storage blocked */ }
    setShow(false);
  }
  return (
    <div className="callout">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="ico"><Bell aria-hidden /></div>
        <div><div className="strong">Get a notification for every new order</div><div className="hint">On this device, even when the portal is closed. Change it any time in Settings → Notifications.</div></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn ghost" onClick={later} disabled={busy}>Not now</button>
        <button className="btn" onClick={enable} disabled={busy}><Bell aria-hidden /> Turn on</button>
      </div>
    </div>
  );
}
