'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import AppShell, { PageHead, PaymentPill } from '../../components/AppShell';
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
        <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All payments</option>
          <option value="claimed">Awaiting verification</option>
          <option value="cod_pending">COD pending</option>
          <option value="verified">Paid</option>
        </select>
      } />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Area</th><th>Total</th><th>Method</th><th>Payment</th></tr></thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/orders/${o.id}`} className="strong" style={{ color: 'var(--brand-ink)' }}>{o.order_number || '(draft)'}</Link></td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dt(o.created_at)}</td>
                  <td>{o.delivery_name || '—'}</td>
                  <td>{o.delivery_area || '—'}</td>
                  <td className="strong">{rs(o.total)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{o.payment_method.replace('_', ' ')}</td>
                  <td><PaymentPill status={o.payment_status} /></td>
                </tr>
              ))}
              {orders && orders.length === 0 && <tr><td colSpan={7} className="empty"><ShoppingBag /><div>No orders yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
