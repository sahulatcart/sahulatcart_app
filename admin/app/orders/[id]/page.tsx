'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Image as ImageIcon, X } from 'lucide-react';
import AppShell, { PageHead, PaymentPill } from '../../../components/AppShell';
import { api, apiJson, rs } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

interface Detail {
  order: { id: string; order_number: string; status: string; payment_method: string; payment_status: string; subtotal: number; discount_total: number; delivery_charge: number; total: number; delivery_name: string; delivery_address: string; delivery_area: string; delivery_city: string; delivery_phone: string };
  items: { name_snapshot: string; quantity: number; unit_price: number; discount: number; line_total: number }[];
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { apiJson<Detail>(`/api/v1/admin/orders/${id}`).then(setD).catch(() => {}); }, [id]);
  useEffect(load, [load]);

  async function act(path: string, body?: object, msg?: string) {
    setBusy(true);
    const r = await api(`/api/v1/admin/orders/${id}/payment/${path}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false);
    if (r.ok) toast(msg || 'Done', 'success'); else toast('Action failed', 'error');
    load();
  }
  async function viewShot() {
    const r = await apiJson<{ url?: string }>(`/api/v1/admin/orders/${id}/screenshot`).catch(() => ({ url: undefined }));
    if (r.url) setShot(r.url); else toast('No stored screenshot for this order', 'error');
  }

  if (!d) return <AppShell><div className="card pad"><div className="skeleton" style={{ height: 200 }} /></div></AppShell>;
  const o = d.order;
  const claimed = o.payment_status === 'claimed';

  return (
    <AppShell>
      <Link href="/orders" className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 10 }}><ArrowLeft size={15} /> Orders</Link>
      <PageHead title={`Order ${o.order_number}`} action={<PaymentPill status={o.payment_status} />} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <div className="card">
            <div className="card-head"><h2 style={{ margin: 0 }}>Items</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Disc.</th><th style={{ textAlign: 'right' }}>Line</th></tr></thead>
                <tbody>
                  {d.items.map((it, i) => (
                    <tr key={i}><td className="strong">{it.name_snapshot}</td><td>{it.quantity}</td><td>{rs(it.unit_price)}</td><td style={{ color: 'var(--success)' }}>-{rs(it.discount)}</td><td style={{ textAlign: 'right' }} className="strong">{rs(it.line_total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'grid', gap: 6 }}>
              <div className="row between"><span className="muted">Subtotal</span><span>{rs(o.subtotal)}</span></div>
              <div className="row between"><span className="muted">Discount</span><span style={{ color: 'var(--success)' }}>-{rs(o.discount_total)}</span></div>
              <div className="row between"><span className="muted">Delivery</span><span>{o.delivery_charge ? rs(o.delivery_charge) : 'Free'}</span></div>
              <div className="row between" style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}><span>Total</span><span>{rs(o.total)}</span></div>
            </div>
          </div>
        </div>

        <div>
          <div className="card pad">
            <h2>Delivery</h2>
            <div style={{ lineHeight: 1.7, fontSize: 13.5 }}>
              <div className="strong">{o.delivery_name}</div>
              <div className="muted">{o.delivery_address}{o.delivery_area ? `, ${o.delivery_area}` : ''}{o.delivery_city ? `, ${o.delivery_city}` : ''}</div>
              <div className="muted">📞 {o.delivery_phone}</div>
            </div>
          </div>

          <div className="card pad">
            <h2>Payment <span className="pill neutral" style={{ textTransform: 'capitalize' }}>{o.payment_method.replace('_', ' ')}</span></h2>
            {o.payment_method === 'bank_transfer' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="btn ghost" onClick={viewShot}><ImageIcon /> View screenshot</button>
                <div className="row">
                  <button className="btn" disabled={!claimed || busy} onClick={() => act('verify', undefined, 'Payment verified')}><Check /> Verify</button>
                  <button className="btn danger" disabled={!claimed || busy} onClick={() => act('reject', { reason: 'screenshot not valid' }, 'Payment rejected')}><X /> Reject</button>
                </div>
                {!claimed && <div className="hint">No claim to review yet.</div>}
              </div>
            )}
            {o.payment_method === 'cod' && (
              <button className="btn" disabled={o.payment_status === 'cod_collected' || busy} onClick={() => act('cod-collected', undefined, 'Marked collected')}><Check /> Mark cash collected</button>
            )}
          </div>
        </div>
      </div>

      {shot && (
        <div className="modal-scrim" onClick={() => setShot(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt="payment screenshot" style={{ display: 'block', maxWidth: '90vw', maxHeight: '86vh' }} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
