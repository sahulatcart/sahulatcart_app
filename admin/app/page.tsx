'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../components/AppShell';
import { apiJson, rs } from '../lib/api';

interface Dash {
  ordersToday: number;
  revenueToday: number;
  pendingPayments: number;
  activeChats: number;
  recentOrders: { id: string; order_number: string; status: string; payment_status: string; total: number; delivery_name: string }[];
}

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    apiJson<Dash>('/api/v1/admin/dashboard').then(setD).catch(() => {});
    apiJson<{ merchant: { settings?: { onboardingCompletedAt?: string | null } } }>('/api/v1/admin/me')
      .then((r) => setNeedsSetup(!r.merchant?.settings?.onboardingCompletedAt))
      .catch(() => {});
  }, []);

  return (
    <AppShell>
      <h1>Dashboard</h1>
      {needsSetup && (
        <div className="section" style={{ background: '#f0fdfa', borderColor: '#0d9488' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>👋 Finish setting up your shop — business info, negotiation rules, bank account, and go live.</span>
            <Link href="/onboarding" className="btn">Complete setup</Link>
          </div>
        </div>
      )}
      <div className="cards">
        <div className="card"><div className="k">Today&apos;s Orders</div><div className="v">{d?.ordersToday ?? '—'}</div></div>
        <div className="card"><div className="k">Today&apos;s Revenue</div><div className="v">{d ? rs(d.revenueToday) : '—'}</div></div>
        <div className="card"><div className="k">Pending Payments</div><div className="v" style={{ color: d?.pendingPayments ? 'var(--danger)' : undefined }}>{d?.pendingPayments ?? '—'}</div></div>
        <div className="card"><div className="k">Active Chats</div><div className="v">{d?.activeChats ?? '—'}</div></div>
      </div>
      <h2>Recent Orders</h2>
      <table>
        <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Payment</th></tr></thead>
        <tbody>
          {(d?.recentOrders ?? []).map((o) => (
            <tr key={o.id}>
              <td><Link href={`/orders/${o.id}`}>{o.order_number}</Link></td>
              <td>{o.delivery_name || '—'}</td>
              <td>{rs(o.total)}</td>
              <td><span className="badge info">{o.status}</span></td>
              <td><span className={`badge ${o.payment_status === 'claimed' ? 'pending' : 'ok'}`}>{o.payment_status}</span></td>
            </tr>
          ))}
          {d && d.recentOrders.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No orders yet.</td></tr>}
        </tbody>
      </table>
    </AppShell>
  );
}
