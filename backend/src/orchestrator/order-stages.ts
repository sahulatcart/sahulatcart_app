// Order stages after payment (SRS P4, FR-P4.1/4.2): confirmed|paid → preparing → dispatched →
// delivered. Each step is one conditional UPDATE (payment-service `transition()`: the filter is
// the state check, so a double-click cannot act twice) plus an order_status_history row. Staff may
// set stages; cancelling is a manager's call (routes). At dispatch the buyer is told: free-form
// while their 24-hour window is open, otherwise `pending_buyer_notice='order_sent'` and the
// merchant's paid button on the order page (M4) sends the template.
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyBuyer, transition, type ActionResult, type Actor } from './payment-service';

/** Which statuses each stage may be set from. Anything else is a 409 (FR-P4.1). */
export const STAGE_FROM = {
  preparing: ['confirmed', 'paid'],
  dispatched: ['preparing'],
  delivered: ['dispatched'],
} as const;
export type Stage = keyof typeof STAGE_FROM;

export interface DispatchDetails { courier?: string | null; trackingRef?: string | null; etaText?: string | null }

const clip = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

async function history(db: SupabaseClient, a: Actor, orderId: string, from: string, to: Stage, note?: string | null): Promise<void> {
  await db.from('order_status_history').insert({ order_id: orderId, from_status: from, to_status: to, changed_by: 'agent', user_id: a.memberId ?? null, note: note ?? null });
}

/** The status the order is in now, for the history row; null when it is not this merchant's. */
async function currentStatus(db: SupabaseClient, a: Actor, orderId: string): Promise<string | null> {
  const r = await db.from('orders').select('status').match({ id: orderId, merchant_id: a.merchantId }).maybeSingle();
  return (r.data?.status as string | undefined) ?? null;
}

export async function markPreparing(db: SupabaseClient, a: Actor, orderId: string): Promise<ActionResult> {
  const from = await currentStatus(db, a, orderId);
  if (!from) return { ok: false, status: 404, message: 'Order not found' };
  const r = await transition(db, a, orderId, { from: [...STAGE_FROM.preparing], match: {}, set: { status: 'preparing' }, conflict: 'Only a confirmed or paid order can be marked as being prepared' });
  if (!('order' in r)) return r;
  await history(db, a, orderId, from, 'preparing');
  return { ok: true };
}

export async function markDispatched(db: SupabaseClient, a: Actor, orderId: string, d: DispatchDetails = {}): Promise<ActionResult> {
  const from = await currentStatus(db, a, orderId);
  if (!from) return { ok: false, status: 404, message: 'Order not found' };
  const courier = clip(d.courier, 60);
  const trackingRef = clip(d.trackingRef, 80);
  const etaText = clip(d.etaText, 80);
  const r = await transition(db, a, orderId, {
    from: [...STAGE_FROM.dispatched],
    match: {},
    set: { status: 'dispatched', courier, tracking_ref: trackingRef, eta_text: etaText },
    conflict: 'Mark the order as being prepared first; only a prepared order can be dispatched',
  });
  if (!('order' in r)) return r;
  await history(db, a, orderId, from, 'dispatched', [courier, trackingRef].filter(Boolean).join(' · ') || null);
  // FR-P4.2: the buyer hears about it. notifyBuyer() sends free-form inside the window; outside it
  // sets pending_buyer_notice='order_sent' for the merchant's paid button and tells the merchant.
  const line = [
    `Aap ka order ${r.order.order_number ?? ''} bhej diya gaya hai.`.replace('  ', ' '),
    courier ? `Courier: ${courier}${trackingRef ? ` (${trackingRef})` : ''}.` : '',
    etaText ? `${etaText}.` : 'Jald pohanch jaye ga, shukriya!',
  ].filter(Boolean).join(' ');
  await notifyBuyer(db, r.order, line, null, 'order_sent');
  return { ok: true };
}

export async function markDelivered(db: SupabaseClient, a: Actor, orderId: string): Promise<ActionResult> {
  const from = await currentStatus(db, a, orderId);
  if (!from) return { ok: false, status: 404, message: 'Order not found' };
  const r = await transition(db, a, orderId, { from: [...STAGE_FROM.delivered], match: {}, set: { status: 'delivered' }, conflict: 'Only a dispatched order can be marked delivered' });
  if (!('order' in r)) return r;
  await history(db, a, orderId, from, 'delivered');
  return { ok: true };
}
