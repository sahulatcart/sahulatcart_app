// Hourly jobs (SRS P4, FR-P4.3). Production only, like the retention job: a local backend shares
// the live database and must never cancel real orders.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from './supabase';
import { logger } from './logger';
import { notify } from './notify';
import { runJob } from './job-runs';
import { notifyBuyer, setCheckoutState } from '../orchestrator/payment-service';

export const DEFAULT_UNPAID_EXPIRY_HOURS = 24;

/** The merchant's `settings.unpaidExpiryHours`, 6–72 (validated on write), else the default. */
export function unpaidExpiryHours(settings: unknown): number {
  const v = (settings as { unpaidExpiryHours?: unknown } | null)?.unpaidExpiryHours;
  return typeof v === 'number' && Number.isInteger(v) && v >= 6 && v <= 72 ? v : DEFAULT_UNPAID_EXPIRY_HOURS;
}

/**
 * A bank-transfer order with no screenshot after the merchant's expiry hours is cancelled: stock
 * back, history row, the merchant told, the buyer told only while their window is open (a paid
 * template for a lapsed order is not worth Meta's rate). Idempotent — the cancel is a conditional
 * UPDATE on `status = 'awaiting_payment'`, so a second run finds nothing. Returns the ids cancelled.
 */
export async function expireUnpaidOrders(db: SupabaseClient, now: Date = new Date()): Promise<string[]> {
  // The widest net first (the shortest allowed expiry), then each order against its own merchant's hours.
  const widest = new Date(now.getTime() - 6 * 3_600_000).toISOString();
  const { data: candidates, error } = await db
    .from('orders')
    .select('id, merchant_id, customer_id, conversation_id, order_number, slip_url, delivery_name, placed_at')
    .eq('status', 'awaiting_payment')
    .eq('payment_status', 'unpaid')
    .not('placed_at', 'is', null)
    .lt('placed_at', widest);
  if (error) { logger.error({ err: error.message }, 'unpaid expiry: query failed'); return []; }
  const cancelled: string[] = [];
  const hoursByMerchant = new Map<string, number>();
  for (const o of (candidates ?? []) as { id: string; merchant_id: string; customer_id: string; conversation_id: string | null; order_number: string | null; slip_url: string | null; delivery_name: string | null; placed_at: string }[]) {
    let hours = hoursByMerchant.get(o.merchant_id);
    if (hours === undefined) {
      const m = await db.from('merchants').select('settings').eq('id', o.merchant_id).maybeSingle();
      hours = unpaidExpiryHours(m.data?.settings);
      hoursByMerchant.set(o.merchant_id, hours);
    }
    if (new Date(o.placed_at).getTime() > now.getTime() - hours * 3_600_000) continue;
    // A screenshot that arrived but was not reviewed yet is the merchant's to decide, never ours.
    const claim = await db.from('payment_claims').select('id').eq('order_id', o.id).limit(1).maybeSingle();
    if (claim.data) continue;
    const reason = `payment not received in ${hours}h`;
    const { data: done } = await db
      .from('orders')
      .update({ status: 'cancelled', cancelled_reason: reason })
      .match({ id: o.id, status: 'awaiting_payment', payment_status: 'unpaid' })
      .select('id')
      .maybeSingle();
    if (!done) continue; // changed meanwhile (paid, claimed, cancelled by someone)
    await Promise.all([
      db.rpc('release_stock', { p_order: o.id }),
      db.from('order_status_history').insert({ order_id: o.id, from_status: 'awaiting_payment', to_status: 'cancelled', changed_by: 'system', note: reason }),
      notify(db, o.merchant_id, { type: 'system', title: `Order ${o.order_number ?? ''} expired unpaid`.trim(), body: `No payment screenshot arrived in ${hours} hours, so the order was cancelled and its items are back in stock.`, data: { orderId: o.id, action: 'unpaid_expired' } }),
    ]);
    await notifyBuyer(db, o, `Maazrat, aapka order ${o.order_number ?? ''} payment na milne ki wajah se cancel ho gaya hai. Dobara order karna ho to yahan message karein.`, null, 'payment_update', 'none');
    await setCheckoutState(db, o, 'completed');
    cancelled.push(o.id);
  }
  if (cancelled.length) logger.info({ count: cancelled.length }, 'unpaid orders expired');
  return cancelled;
}

export function startUnpaidExpiryJob(): void {
  // F1: each run writes a job_runs heartbeat for the platform console's Jobs tab.
  const run = () => {
    const db = getServiceClient();
    void runJob(db, 'unpaid_expiry', 3600, async () => ({ cancelled: (await expireUnpaidOrders(db)).length }));
  };
  run();
  setInterval(run, 60 * 60_000).unref();
}
