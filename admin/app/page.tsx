'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock, MessageSquare, ShoppingBag, Sparkles, Wallet } from 'lucide-react';
import AppShell, { EmptyState, PageHead, PaymentPill, StatusPill } from '../components/AppShell';
import { apiJson, rs } from '../lib/api';

interface Dash {
  ordersToday: number; revenueToday: number; pendingPayments: number; activeChats: number;
  recentOrders: { id: string; order_number: string; status: string; payment_status: string; total: number; delivery_name: string }[];
}

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    apiJson<Dash>('/api/v1/admin/dashboard').then(setD).catch(() => {});
    apiJson<{ merchant: { settings?: { onboardingCompletedAt?: string | null } } }>('/api/v1/admin/me')
      .then((r) => setNeedsSetup(!r.merchant?.settings?.onboardingCompletedAt)).catch(() => {});
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

      {needsSetup && (
        <div className="callout">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div className="ico"><Sparkles aria-hidden /></div>
            <div><div className="strong">Finish setting up your shop</div><div className="hint">Business info, negotiation rules, bank account — then go live.</div></div>
          </div>
          <Link href="/onboarding" className="btn">Complete setup <ArrowRight aria-hidden /></Link>
        </div>
      )}

      <div className="stats">
        {stat("Today's orders", d?.ordersToday, ShoppingBag)}
        {stat("Today's revenue", d && rs(d.revenueToday), Wallet)}
        {stat('Payments to verify', d?.pendingPayments, Clock, !!d?.pendingPayments)}
        {stat('Active chats', d?.activeChats, MessageSquare)}
      </div>

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
