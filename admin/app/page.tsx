'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, Clock, Gauge, MessageSquare, MessagesSquare, Package, ShoppingBag, Sparkles, Truck, Wallet } from 'lucide-react';
import AppShell, { EmptyState, PageHead, PaymentPill, StatusPill } from '../components/AppShell';
import { api, apiError, apiJson, rs } from '../lib/api';
import { ago, phone } from '../lib/format';
import { enablePush, pushState } from '../lib/push';
import { useToast } from '../components/Toast';

interface Usage { month: string; outbound: number; freeQuota: number; paidOutbound: number; ratePaisa: number; estimatedCostPaisa: number; afterQuota: 'continue' | 'handoff'; llmCallsToday: number; llmDailyCap: number }
interface QOrder { id: string; order_number: string; status?: string; total: number; delivery_name: string | null; created_at: string }
interface QChat { id: string; last_message_at: string; unread_count: number; customers: { name: string | null; wa_id: string } | null }
interface Dash {
  ordersToday: number; revenueToday: number; pendingPayments: number; activeChats: number; toPrepare: number; toDispatch: number;
  recentOrders: { id: string; order_number: string; status: string; payment_status: string; total: number; delivery_name: string }[];
  // UI pass 2: the oldest five of each thing that waits on the merchant.
  queue: { payments: QOrder[]; chats: QChat[]; fulfil: QOrder[] };
}

export default function Dashboard() {
  const toast = useToast();
  const [d, setD] = useState<Dash | null>(null);
  // FR-P2.4: the card shows until every readiness check passes AND the bot is on; it links to the first open step.
  const [setup, setSetup] = useState<{ done: number; next: string | null; ready: boolean; botOn: boolean } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  // P7: an unpaid invoice or a used-up allowance puts the bot in hand-over mode; say so here, with the way out.
  const [billing, setBilling] = useState<{ mode: string; reason: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { apiJson<Dash>('/api/v1/admin/dashboard').then(setD).catch(() => {}); }, []);
  useEffect(() => {
    load();
    apiJson<{ mode: string; reason: string | null }>('/api/v1/admin/billing').then(setBilling).catch(() => {});
    apiJson<Usage>('/api/v1/admin/usage').then(setUsage).catch(() => {});
    Promise.all([
      apiJson<{ ready: boolean; failing: string[] }>('/api/v1/admin/readiness'),
      apiJson<{ merchant: { settings?: { botEnabled?: boolean } } }>('/api/v1/admin/me'),
    ]).then(([r, me]) => {
      const botOn = me.merchant?.settings?.botEnabled !== false; // missing means on, as the backend reads it (review P2-12)
      setSetup(r.ready && botOn ? null : { done: 7 - r.failing.length, next: r.failing[0] ?? null, ready: r.ready, botOn });
    }).catch(() => {});
  }, [load]);

  // Act in place for the one step that needs no further input; dispatch needs a courier, so it links to the order.
  async function startPreparing(o: QOrder) {
    setBusy(o.id);
    const r = await api(`/api/v1/admin/orders/${o.id}/preparing`, { method: 'POST' });
    setBusy(null);
    if (r.ok) toast(`${o.order_number} is being prepared`, 'success'); else toast(await apiError(r), 'error');
    load();
  }

  const stat = (k: string, v: React.ReactNode, Icon: typeof ShoppingBag) => (
    <div className="stat">
      <div className="ico"><Icon aria-hidden /></div>
      <div className="k">{k}</div>
      <div className="v">{d ? v : <span className="skeleton block" style={{ height: 32, width: 90 }} />}</div>
    </div>
  );

  const q = d?.queue;
  const waiting = q ? q.payments.length + q.chats.length + q.fulfil.length : 0;

  return (
    <AppShell>
      <PageHead title="Dashboard" sub="Your shop at a glance — today, in Pakistan time" />

      <PushNudge />
      {billing?.mode === 'handoff' && (
        <div className="callout" role="status">
          <div className="row no-wrap-row">
            <div className="ico"><AlertTriangle aria-hidden /></div>
            <div>
              <div className="strong">{billing.reason === 'limit' ? 'The bot is handing chats to you: this month\'s conversation allowance is used up' : 'The bot is handing chats to you: an invoice is unpaid'}</div>
              <div className="hint">Every message is still stored and you can reply from the inbox. {billing.reason === 'limit' ? 'Ask for a bigger plan, or wait for the month to reset.' : 'Pay the invoice and enter the transfer reference to restore selling.'}</div>
            </div>
          </div>
          <Link href="/billing" className="btn">Open billing <ArrowRight aria-hidden /></Link>
        </div>
      )}
      {setup && (
        <div className="callout">
          <div className="row no-wrap-row">
            <div className="ico"><Sparkles aria-hidden /></div>
            <div>
              <div className="strong">{setup.ready ? 'Everything is set — switch the bot on' : setup.botOn ? 'Your bot is live; finish setting up' : 'Finish setting up your shop'}</div>
              <div className="hint">{setup.ready ? 'All seven steps are done. Go live and the bot starts selling.' : setup.botOn ? `${setup.done} of 7 steps done. Finish them so you can pause and resume the bot safely.` : `${setup.done} of 7 steps done. The bot stays off until all seven are.`}</div>
            </div>
          </div>
          <Link href={setup.next ? `/onboarding?step=${setup.next}` : '/onboarding'} className="btn">{setup.ready ? 'Go live' : 'Continue setup'} <ArrowRight aria-hidden /></Link>
        </div>
      )}

      {/* The morning question first: what is waiting on me? Oldest first, acted on from here. */}
      <section className="card" aria-labelledby="needs-you">
        <div className="card-head">
          <div><h2 id="needs-you">Needs you</h2><div className="desc">What the bot cannot finish on its own, oldest first. Everything else it handles.</div></div>
        </div>
        {!d && <div className="pad"><div className="skeleton" style={{ height: 18 }} /></div>}
        {d && waiting === 0 && <EmptyState icon={CheckCircle2} title="Nothing is waiting on you" hint="New payments, chats and orders will appear here the moment they need a decision." />}
        {q && q.payments.length > 0 && (
          <QueueGroup title="Payments to verify" count={d!.pendingPayments} href="/orders" all="All orders">
            {q.payments.map((o) => (
              <li key={o.id} className="feed-item">
                <span className="ico warning"><Clock aria-hidden /></span>
                <div className="fill">
                  <div className="t"><span className="mono">{o.order_number}</span> · {rs(o.total)}</div>
                  <div className="b">{o.delivery_name || 'No name'} · screenshot sent, placed {ago(o.created_at)}</div>
                </div>
                <div className="feed-actions"><Link href={`/orders/${o.id}`} className="btn ghost sm">Review payment</Link></div>
              </li>
            ))}
          </QueueGroup>
        )}
        {q && q.chats.length > 0 && (
          <QueueGroup title="Chats waiting for your reply" count={q.chats.length} href="/inbox" all="Open inbox">
            {q.chats.map((c) => (
              <li key={c.id} className="feed-item">
                <span className="ico brand"><MessagesSquare aria-hidden /></span>
                <div className="fill">
                  <div className="t">{c.customers?.name || phone(c.customers?.wa_id)}</div>
                  <div className="b">{c.unread_count} unread · last message {ago(c.last_message_at)}</div>
                </div>
                <div className="feed-actions"><Link href={`/inbox?c=${c.id}`} className="btn ghost sm">Reply</Link></div>
              </li>
            ))}
          </QueueGroup>
        )}
        {q && q.fulfil.length > 0 && (
          <QueueGroup title="Orders to prepare and send" count={d!.toPrepare + d!.toDispatch} href="/orders" all="All orders">
            {q.fulfil.map((o) => (
              <li key={o.id} className="feed-item">
                <span className="ico">{o.status === 'preparing' ? <Truck aria-hidden /> : <Package aria-hidden />}</span>
                <div className="fill">
                  <div className="t"><span className="mono">{o.order_number}</span> · {rs(o.total)}</div>
                  <div className="b">{o.delivery_name || 'No name'} · {o.status === 'preparing' ? 'being prepared' : 'placed'} {ago(o.created_at)}</div>
                </div>
                <div className="feed-actions">
                  {o.status === 'preparing'
                    ? <Link href={`/orders/${o.id}`} className="btn ghost sm">Dispatch</Link>
                    : <button className="btn ghost sm" disabled={busy === o.id} onClick={() => startPreparing(o)}><Package aria-hidden /> Start preparing</button>}
                </div>
              </li>
            ))}
          </QueueGroup>
        )}
      </section>

      <div className="stats mt-2">
        {stat("Today's orders", d?.ordersToday, ShoppingBag)}
        {stat("Today's revenue", d && rs(d.revenueToday), Wallet)}
        {stat('Chats the bot is handling', d?.activeChats, MessageSquare)}
      </div>

      {usage && (() => {
        const pct = Math.min(100, Math.round((usage.outbound / usage.freeQuota) * 100));
        const tone = usage.outbound >= usage.freeQuota ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--brand)';
        return (
          <div className="card pad mt-2">
            <div className="row between">
              <h2 className="m0 row"><Gauge aria-hidden /> Messages this month</h2>
              <Link href="/settings#messages" className="link small">What happens after 1,000 <ArrowRight size={14} aria-hidden /></Link>
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 10 }}>{usage.outbound.toLocaleString('en-PK')} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>of {usage.freeQuota.toLocaleString('en-PK')} free</span></div>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Free messages used" style={{ height: 8, borderRadius: 4, background: 'var(--surface)', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
            </div>
            <div className="hint mt-1">
              {usage.paidOutbound > 0
                ? `${usage.paidOutbound.toLocaleString('en-PK')} paid messages so far, about ${rs(usage.estimatedCostPaisa)} at Meta's rate of ${rs(usage.ratePaisa)} each. `
                : `After ${usage.freeQuota.toLocaleString('en-PK')}, each message costs about ${rs(usage.ratePaisa)} (Meta's rate; check the current card). `}
              {usage.afterQuota === 'handoff' ? 'Past the free messages the bot hands new chats to you.' : 'Past the free messages the bot keeps selling.'}
              {' '}AI calls today: {usage.llmCallsToday.toLocaleString('en-PK')} of {usage.llmDailyCap.toLocaleString('en-PK')}. This is an estimate; WhatsApp Manager has the exact count.
            </div>
          </div>
        );
      })()}

      <div className="card mt-2">
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

/** One group of the queue: a heading with the full count, a link to the page that lists them all, the oldest five. */
function QueueGroup({ title, count, href, all, children }: { title: string; count: number; href: string; all: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="queue-head">
        <h3>{title} <span className="n">{count}</span></h3>
        <Link href={href} className="link">{all} <ArrowRight size={14} aria-hidden /></Link>
      </div>
      <ul className="feed">{children}</ul>
    </section>
  );
}

/**
 * "Turn on phone notifications" (P3): shown once per device while push is possible but not yet on —
 * and only when the server has VAPID keys and the viewer is an owner or manager (staff are never
 * alerted), so nobody is invited to turn on something that cannot fire (review P3-3).
 */
function PushNudge() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem('sk_push_nudge') === 'off'; } catch { /* storage blocked */ }
    if (dismissed) return;
    Promise.all([
      pushState(),
      fetch('/api/v1/config').then((r) => r.json()) as Promise<{ vapidPublicKey?: string | null }>,
      apiJson<{ role?: string; isPlatformAdmin?: boolean }>('/api/v1/admin/me'),
    ]).then(([st, cfg, me]) => {
      const manager = me.isPlatformAdmin || me.role === 'owner' || me.role === 'manager';
      setShow(st === 'available' && !!cfg.vapidPublicKey && !!manager);
    }).catch(() => {});
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
      <div className="row no-wrap-row">
        <div className="ico"><Bell aria-hidden /></div>
        <div><div className="strong">Get a notification for every new order</div><div className="hint">On this device, even when the portal is closed. Change it any time in Settings → Notifications.</div></div>
      </div>
      <div className="row gap-1">
        <button className="btn ghost" onClick={later} disabled={busy}>Not now</button>
        <button className="btn" onClick={enable} disabled={busy}><Bell aria-hidden /> Turn on</button>
      </div>
    </div>
  );
}
