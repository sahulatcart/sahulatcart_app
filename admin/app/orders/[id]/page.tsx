'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Banknote, Check, Image as ImageIcon, MapPin, MessageCircle, Phone, User, X } from 'lucide-react';
import AppShell, { BackLink, PageHead, PaymentPill, StatusPill, humanize } from '../../../components/AppShell';
import { api, apiError, apiJson, dt, rs } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

interface Detail {
  order: { id: string; order_number: string; status: string; payment_method: string; payment_status: string; subtotal: number; discount_total: number; delivery_charge: number; total: number; delivery_name: string; delivery_address: string; delivery_area: string; delivery_city: string; delivery_phone: string; placed_at: string | null; created_at: string };
  items: { name_snapshot: string; quantity: number; unit_price: number; discount: number; line_total: number }[];
  windowExpiresAt: string | null;
  pendingBuyerNotice: 'payment_update' | 'order_sent' | null;
  noticePricePaisa: number;
}

/** "Free to confirm until 3:40 pm tomorrow" — the buyer's 24-hour window decides the price of a message. */
function WindowNote({ until, pricePaisa }: { until: string | null; pricePaisa: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!until) return null;
  const left = new Date(until).getTime() - now;
  if (left <= 0) return <div className="hint" style={{ marginTop: 8 }}>Buyer&rsquo;s window closed: confirming now sends nothing for free; a paid notice (about {rs(pricePaisa)}) appears below once you decide.</div>;
  const h = Math.floor(left / 3_600_000); const m = Math.floor((left % 3_600_000) / 60_000);
  return <div className="hint" style={{ marginTop: 8, color: 'var(--success)' }}>Free to confirm until {dt(until)} ({h}h {m}m left): the buyer wrote recently, so the confirmation goes out as a normal message.</div>;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { apiJson<Detail>(`/api/v1/admin/orders/${id}`).then(setD).catch(() => {}); }, [id]);
  useEffect(load, [load]);
  // Escape closes the screenshot viewer.
  useEffect(() => {
    if (!shot) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShot(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shot]);

  async function act(path: string, body?: object, msg?: string) {
    setBusy(true);
    const r = await api(`/api/v1/admin/orders/${id}/${path}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false);
    if (r.ok) toast(msg || 'Done', 'success'); else toast(await apiError(r), 'error');
    load();
  }
  async function viewShot() {
    const r = await apiJson<{ url?: string }>(`/api/v1/admin/orders/${id}/screenshot`).catch(() => ({ url: undefined }));
    if (r.url) setShot(r.url); else toast('No stored screenshot for this order', 'error');
  }

  if (!d) return <AppShell><div className="skeleton" style={{ height: 40, width: 260, marginBottom: 20 }} /><div className="split"><div className="skeleton" style={{ height: 260 }} /><div className="skeleton" style={{ height: 200 }} /></div></AppShell>;
  const o = d.order;
  const claimed = o.payment_status === 'claimed';
  const cancellable = ['draft', 'confirmed', 'awaiting_payment', 'preparing'].includes(o.status);
  const cancel = () => confirm('Cancel this order? Its items go back into stock and the buyer is told on WhatsApp.') && act('cancel', undefined, 'Order cancelled');
  const address = [o.delivery_address, o.delivery_area, o.delivery_city].filter(Boolean).join(', ');

  return (
    <AppShell>
      <BackLink href="/orders" label="Orders" />
      <PageHead title={`Order ${o.order_number ?? '(draft)'}`} sub={`Placed ${dt(o.placed_at ?? o.created_at, true)} (PKT)`}
        action={<><StatusPill status={o.status} /><PaymentPill status={o.payment_status} /></>} />

      <div className="split">
        <div className="card">
          <div className="card-head"><h2>Items</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num hide-sm">Unit</th><th className="num hide-sm">Discount</th><th className="num">Line</th></tr></thead>
              <tbody>
                {d.items.map((it, i) => (
                  <tr key={i}>
                    <td className="strong">{it.name_snapshot}</td>
                    <td className="num">{it.quantity}</td>
                    <td className="num hide-sm">{rs(it.unit_price)}</td>
                    <td className="num hide-sm" style={{ color: it.discount ? 'var(--success)' : undefined }}>{it.discount ? `−${rs(it.discount)}` : '—'}</td>
                    <td className="num strong">{rs(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot" style={{ display: 'block' }}>
            <div className="kv num">
              <div className="row"><span className="muted">Subtotal</span><span>{rs(o.subtotal)}</span></div>
              <div className="row"><span className="muted">Discount</span><span style={{ color: o.discount_total ? 'var(--success)' : undefined }}>{o.discount_total ? `−${rs(o.discount_total)}` : '—'}</span></div>
              <div className="row"><span className="muted">Delivery</span><span>{o.delivery_charge ? rs(o.delivery_charge) : 'Free'}</span></div>
              <div className="row total"><span>Total</span><span>{rs(o.total)}</span></div>
            </div>
          </div>
        </div>

        <div>
          <div className="card pad">
            <h2 style={{ marginBottom: 14 }}>Delivery</h2>
            <div className="detail-line"><User aria-hidden /><span className="strong">{o.delivery_name || '—'}</span></div>
            <div className="detail-line"><MapPin aria-hidden /><span>{address || '—'}</span></div>
            <div className="detail-line"><Phone aria-hidden /><span className="mono">{o.delivery_phone || '—'}</span></div>
          </div>

          <div className="card pad">
            <div className="row between" style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Payment</h2>
              <span className="pill neutral"><Banknote size={13} aria-hidden />{humanize(o.payment_method)}</span>
            </div>
            {o.payment_method === 'bank_transfer' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <button className="btn ghost block" onClick={viewShot}><ImageIcon aria-hidden /> View screenshot</button>
                <div className="grid-2" style={{ gap: 8 }}>
                  <button className="btn" disabled={!claimed || busy} onClick={() => act('payment/verify', undefined, 'Payment verified')}><Check aria-hidden /> Verify</button>
                  <button className="btn danger-ghost" disabled={!claimed || busy} onClick={() => act('payment/reject', { reason: 'screenshot not valid' }, 'Payment rejected')}><X aria-hidden /> Reject</button>
                </div>
                {!claimed && <div className="hint">No payment screenshot to review yet.</div>}
              </div>
            )}
            {o.payment_method === 'cod' && (
              <button className="btn block" disabled={o.payment_status === 'cod_collected' || busy} onClick={() => act('payment/cod-collected', undefined, 'Marked collected')}><Check aria-hidden /> Mark cash collected</button>
            )}
            {o.payment_method === 'unset' && <div className="hint">The buyer hasn&apos;t chosen a payment method yet.</div>}
            {o.payment_method === 'bank_transfer' && claimed && <WindowNote until={d.windowExpiresAt} pricePaisa={d.noticePricePaisa} />}
            {d.pendingBuyerNotice && (
              <>
                <div className="divider" />
                <div className="hint" style={{ marginBottom: 8 }}>The buyer&rsquo;s 24-hour window had closed, so their {d.pendingBuyerNotice === 'order_sent' ? 'dispatch notice' : 'payment update'} was not sent. Sending it now uses a pre-approved message and costs about {rs(d.noticePricePaisa)} (Meta&rsquo;s rate).</div>
                <button className="btn block" disabled={busy} onClick={() => act('notify-buyer', { kind: d.pendingBuyerNotice }, 'Notice sent to the buyer')}><MessageCircle aria-hidden /> Send for about {rs(d.noticePricePaisa)}</button>
              </>
            )}
            {cancellable && (
              <>
                <div className="divider" />
                <button className="btn danger-ghost block" disabled={busy} onClick={cancel}><X aria-hidden /> Cancel order</button>
                <div className="hint" style={{ marginTop: 6 }}>Items go back into stock and the buyer is told on WhatsApp.</div>
              </>
            )}
          </div>
        </div>
      </div>

      {shot && (
        <div className="modal-scrim" onClick={() => setShot(null)} role="dialog" aria-modal="true" aria-label="Payment screenshot">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="btn ghost icon-btn close" onClick={() => setShot(null)} aria-label="Close" autoFocus><X /></button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt="Payment screenshot sent by the buyer" style={{ display: 'block', maxWidth: '90vw', maxHeight: '86vh' }} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
