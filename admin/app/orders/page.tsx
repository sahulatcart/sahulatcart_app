'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import AppShell, { EmptyState, PageHead, PaymentPill, StatusPill, humanize } from '../../components/AppShell';
import { apiJson, dt, rs } from '../../lib/api';

interface O { id: string; order_number: string; status: string; payment_method: string; payment_status: string; total: number; delivery_name: string; delivery_area: string; created_at: string }

export default function Orders() {
  const [orders, setOrders] = useState<O[] | null>(null);
  const [payment, setPayment] = useState('');
  useEffect(() => {
    apiJson<{ orders: O[] }>(`/api/v1/admin/orders${payment ? `?payment=${payment}` : ''}`).then((r) => setOrders(r.orders)).catch(() => setOrders([]));
  }, [payment]);

  return (
    <AppShell>
      <PageHead title="Orders" sub="Every order placed through the bot" action={
        <>
          <label htmlFor="payment-filter" className="sr-only">Filter by payment</label>
          <select id="payment-filter" value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All payments</option>
            <option value="claimed">Awaiting verification</option>
            <option value="cod_pending">COD pending</option>
            <option value="verified">Paid</option>
          </select>
        </>
      } />
      <div className="card">
        {orders && orders.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={payment ? 'Nothing here' : 'No orders yet'} hint={payment ? 'No orders match this payment filter.' : 'Orders appear here as soon as the bot closes a sale.'} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Status</th><th>Payment</th><th className="num">Total</th></tr></thead>
              <tbody>
                {(orders ?? []).map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/orders/${o.id}`} className="link mono">{o.order_number || '(draft)'}</Link></td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dt(o.created_at)}</td>
                    <td><div className="strong">{o.delivery_name || '—'}</div>{o.delivery_area && <div className="hint">{o.delivery_area}</div>}</td>
                    <td><StatusPill status={o.status} /></td>
                    <td><PaymentPill status={o.payment_status} /><div className="hint">{humanize(o.payment_method)}</div></td>
                    <td className="num strong">{rs(o.total)}</td>
                  </tr>
                ))}
                {!orders && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 18 }} /></td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
