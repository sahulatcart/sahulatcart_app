'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AppShell from '../../../components/AppShell';
import { api, apiJson, rs } from '../../../lib/api';

interface Detail {
  order: { id: string; order_number: string; status: string; payment_method: string; payment_status: string; subtotal: number; discount_total: number; delivery_charge: number; total: number; delivery_name: string; delivery_address: string; delivery_area: string; delivery_city: string; delivery_phone: string };
  items: { name_snapshot: string; quantity: number; unit_price: number; discount: number; line_total: number }[];
  payment: { method: string; status: string; screenshot_url: string | null } | null;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { apiJson<Detail>(`/api/v1/admin/orders/${id}`).then(setD).catch(() => {}); }, [id]);
  useEffect(load, [load]);

  async function act(path: string, body?: object) {
    setBusy(true);
    await api(`/api/v1/admin/orders/${id}/payment/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    load();
  }
  async function viewShot() {
    const r = await apiJson<{ url?: string }>(`/api/v1/admin/orders/${id}/screenshot`).catch(() => ({ url: undefined }));
    if (r.url) setShot(r.url);
    else alert('No stored screenshot for this order.');
  }

  if (!d) return <AppShell><p>Loading…</p></AppShell>;
  const o = d.order;
  const claimed = o.payment_status === 'claimed';

  return (
    <AppShell>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Order {o.order_number}</h1>
        <span className={`badge ${claimed ? 'pending' : o.payment_status === 'verified' ? 'ok' : 'info'}`}>{o.payment_status}</span>
      </div>

      <div className="section">
        <h2>Items</h2>
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Discount</th><th>Line</th></tr></thead>
          <tbody>
            {d.items.map((it, i) => (
              <tr key={i}><td>{it.name_snapshot}</td><td>{it.quantity}</td><td>{rs(it.unit_price)}</td><td>-{rs(it.discount)}</td><td>{rs(it.line_total)}</td></tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 12, lineHeight: 1.8 }}>
          <div>Subtotal: {rs(o.subtotal)}</div>
          <div>Discount: -{rs(o.discount_total)}</div>
          <div>Delivery: {o.delivery_charge ? rs(o.delivery_charge) : 'Free'}</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Total: {rs(o.total)}</div>
        </div>
      </div>

      <div className="section">
        <h2>Delivery</h2>
        <p style={{ lineHeight: 1.7 }}>
          {o.delivery_name}<br />
          {o.delivery_address}{o.delivery_area ? `, ${o.delivery_area}` : ''}{o.delivery_city ? `, ${o.delivery_city}` : ''}<br />
          {o.delivery_phone}
        </p>
      </div>

      <div className="section">
        <h2>Payment — {o.payment_method}</h2>
        {o.payment_method === 'bank_transfer' && (
          <div className="row">
            <button className="btn sec" onClick={viewShot}>View screenshot</button>
            <button className="btn" disabled={!claimed || busy} onClick={() => act('verify')}>✓ Verify payment</button>
            <button className="btn danger" disabled={!claimed || busy} onClick={() => act('reject', { reason: 'screenshot not valid' })}>✗ Reject</button>
          </div>
        )}
        {o.payment_method === 'cod' && (
          <button className="btn" disabled={o.payment_status === 'cod_collected' || busy} onClick={() => act('cod-collected')}>Mark cash collected</button>
        )}
        {shot && <div style={{ marginTop: 14 }}><img src={shot} alt="screenshot" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)' }} /></div>}
      </div>
    </AppShell>
  );
}
