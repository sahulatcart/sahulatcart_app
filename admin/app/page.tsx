'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageSquare, ShoppingBag, Wallet, Clock } from 'lucide-react';
import AppShell, { PageHead, PaymentPill } from '../components/AppShell';
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

  return (
    <AppShell>
      <PageHead title="Dashboard" sub="Your shop at a glance" />

      {needsSetup && (
        <div className="card pad" style={{ marginBottom: 16, background: 'linear-gradient(100deg, var(--brand-tint), var(--surface))', borderColor: 'var(--brand-tint-2)' }}>
          <div className="row between">
            <div><strong>👋 Finish setting up your shop</strong><div className="hint">Business info, negotiation rules, bank account — then go live.</div></div>
            <Link href="/onboarding" className="btn">Complete setup <ArrowRight /></Link>
          </div>
        </div>
      )}

      <div className="stats">
        <div className="stat"><div className="ico"><ShoppingBag /></div><div className="k">Today&apos;s orders</div><div className="v">{d?.ordersToday ?? '—'}</div></div>
        <div className="stat"><div className="ico"><Wallet /></div><div className="k">Today&apos;s revenue</div><div className="v">{d ? rs(d.revenueToday) : '—'}</div></div>
        <div className={`stat ${d?.pendingPayments ? 'warn' : ''}`}><div className="ico"><Clock /></div><div className="k">Pending payments</div><div className="v">{d?.pendingPayments ?? '—'}</div></div>
        <div className="stat"><div className="ico"><MessageSquare /></div><div className="k">Active chats</div><div className="v">{d?.activeChats ?? '—'}</div></div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="card-head"><h2 style={{ margin: 0 }}>Recent orders</h2><Link href="/orders" className="hint">View all →</Link></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Payment</th></tr></thead>
            <tbody>
              {(d?.recentOrders ?? []).map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/orders/${o.id}`} className="strong" style={{ color: 'var(--brand-ink)' }}>{o.order_number}</Link></td>
                  <td>{o.delivery_name || '—'}</td>
                  <td className="strong">{rs(o.total)}</td>
                  <td><span className="pill neutral">{o.status}</span></td>
                  <td><PaymentPill status={o.payment_status} /></td>
                </tr>
              ))}
              {d && d.recentOrders.length === 0 && <tr><td colSpan={5} className="empty">No orders yet — share your WhatsApp number to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
