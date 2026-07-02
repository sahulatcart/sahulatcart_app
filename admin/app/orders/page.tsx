'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import { apiJson, rs } from '../../lib/api';

interface O { id: string; order_number: string; status: string; payment_method: string; payment_status: string; total: number; delivery_name: string; delivery_area: string; created_at: string }

export default function Orders() {
  const [orders, setOrders] = useState<O[]>([]);
  const [payment, setPayment] = useState('');
  useEffect(() => {
    apiJson<{ orders: O[] }>(`/api/v1/admin/orders${payment ? `?payment=${payment}` : ''}`).then((r) => setOrders(r.orders)).catch(() => {});
  }, [payment]);

  return (
    <AppShell>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Orders</h1>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payments</option>
          <option value="claimed">Awaiting verification</option>
          <option value="cod_pending">COD pending</option>
          <option value="verified">Paid</option>
        </select>
      </div>
      <table>
        <thead><tr><th>Order</th><th>Customer</th><th>Area</th><th>Total</th><th>Method</th><th>Payment</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/orders/${o.id}`}>{o.order_number || '(draft)'}</Link></td>
              <td>{o.delivery_name || '—'}</td>
              <td>{o.delivery_area || '—'}</td>
              <td>{rs(o.total)}</td>
              <td>{o.payment_method}</td>
              <td><span className={`badge ${o.payment_status === 'claimed' ? 'pending' : o.payment_status === 'verified' ? 'ok' : 'info'}`}>{o.payment_status}</span></td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No orders.</td></tr>}
        </tbody>
      </table>
    </AppShell>
  );
}
