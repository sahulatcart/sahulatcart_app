import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotState } from '@app/shared';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { sendDocument, sendTemplate, sendText } from '../whatsapp/client';
import { approvedTemplate, type TemplateKind } from '../whatsapp/templates';
import { signedSlipUrl } from './slip';
import { orderSlipText } from './order-service';

/** Who is acting: the merchant is always server-derived; memberId (merchant_users.id) feeds the audit columns. */
export interface Actor {
  merchantId: string;
  memberId?: string;
}
export type ActionResult = { ok: true } | { ok: false; status: 404 | 409; message: string };

export interface OrderRow {
  id: string;
  merchant_id: string;
  customer_id: string;
  conversation_id: string | null;
  order_number: string | null;
  slip_url: string | null;
  delivery_name?: string | null;
}

interface Transition {
  from: string[]; // order.status values the action is valid in
  match: Record<string, string>; // further required column values (payment method/status)
  set: Record<string, unknown>;
  conflict: string; // shown to the merchant when the order is not in that state
}

/**
 * Apply a status change atomically: the UPDATE's own filter is the state check, so a
 * double-click, two tabs or a stale page can never verify/reject/collect twice.
 */
export async function transition(db: SupabaseClient, a: Actor, orderId: string, t: Transition): Promise<{ order: OrderRow } | Exclude<ActionResult, { ok: true }>> {
  const { data, error } = await db
    .from('orders')
    .update(t.set)
    .match({ id: orderId, merchant_id: a.merchantId, ...t.match })
    .in('status', t.from)
    .select('id, merchant_id, customer_id, conversation_id, order_number, slip_url, delivery_name')
    .maybeSingle();
  if (error) logger.error({ err: error.message, orderId }, 'order transition failed');
  if (data) return { order: data as OrderRow };
  const exists = await db.from('orders').select('id').match({ id: orderId, merchant_id: a.merchantId }).maybeSingle();
  return exists.data ? { ok: false, status: 409, message: t.conflict } : { ok: false, status: 404, message: 'Order not found' };
}

/** The buyer's chat, its number and whether their 24-hour window is still open. */
async function buyerChannel(db: SupabaseClient, order: OrderRow): Promise<{ waId?: string; phoneNumberId?: string; windowOpen: boolean }> {
  const [cust, conv] = await Promise.all([
    db.from('customers').select('wa_id').eq('id', order.customer_id).single(),
    order.conversation_id ? db.from('conversations').select('whatsapp_number_id, window_expires_at').eq('id', order.conversation_id).single() : null,
  ]);
  const numberQuery = db.from('whatsapp_numbers').select('phone_number_id');
  const num = conv?.data?.whatsapp_number_id
    ? await numberQuery.eq('id', conv.data.whatsapp_number_id).maybeSingle()
    : await numberQuery.eq('merchant_id', order.merchant_id).limit(1).maybeSingle();
  return {
    waId: cust.data?.wa_id as string | undefined,
    phoneNumberId: num.data?.phone_number_id as string | undefined,
    windowOpen: !conv?.data?.window_expires_at || new Date(conv.data.window_expires_at).getTime() > Date.now(),
  };
}

async function recordOutbound(db: SupabaseClient, order: OrderRow, type: 'text' | 'document' | 'template', body: string, waMessageId: string, templateName?: string): Promise<void> {
  if (!order.conversation_id) return;
  await db.from('messages').insert({
    conversation_id: order.conversation_id,
    merchant_id: order.merchant_id,
    direction: 'outbound',
    sender: 'system',
    type,
    body,
    wa_message_id: waMessageId,
    status: 'sent',
    ...(templateName ? { template_name: templateName } : {}),
  });
}

/**
 * WhatsApp the buyer on the number their chat came in on. Inside their 24-hour window this is a
 * free-form message (free within the shop's monthly allowance, M5). Outside it only a template
 * may be sent, and since 1 October 2026 every template is charged, so nothing is sent: the order
 * is marked `pending_buyer_notice` and the merchant gets a button on the order page that shows the
 * price (notifyBuyerNow). The slip PDF, when there is one, is the message itself (one send, the
 * text as its caption), not a second message.
 */
export async function notifyBuyer(db: SupabaseClient, order: OrderRow, text: string, slipKey?: string | null, notice: TemplateKind = 'payment_update', fallback: 'notice' | 'none' = 'notice'): Promise<void> {
  const { waId, phoneNumberId, windowOpen } = await buyerChannel(db, order);

  let sent: { waMessageId: string | null } = { waMessageId: null };
  let type: 'text' | 'document' = 'text';
  if (waId && phoneNumberId && windowOpen) {
    const url = slipKey ? await signedSlipUrl(db, slipKey) : null;
    if (url) {
      sent = await sendDocument(phoneNumberId, waId, url, `Order-${order.order_number ?? 'slip'}.pdf`, text);
      type = 'document';
    } else {
      sent = await sendText(phoneNumberId, waId, text);
    }
  }
  if (sent.waMessageId) {
    await recordOutbound(db, order, type, text, sent.waMessageId);
    return;
  }
  // 'none': the message was only worth sending for free (an expired unpaid order, P4) — no paid
  // notice is offered and the merchant is not told about the silence.
  if (fallback === 'none') return;
  const price = `Rs ${Math.round(loadConfig().META_UTILITY_RATE_PAISA / 100)}`;
  const why = windowOpen
    ? 'The WhatsApp message could not be sent.'
    : `The buyer last messaged over 24 hours ago, so WhatsApp allows only a paid template now (about ${price}).`;
  await db.from('orders').update({ pending_buyer_notice: notice }).eq('id', order.id);
  await notify(db, order.merchant_id, {
    type: 'system',
    title: windowOpen ? `Could not message the buyer — order ${order.order_number ?? ''}`.trim() : `Buyer's window closed — order ${order.order_number ?? ''}`.trim(),
    body: windowOpen ? `${why} Please contact ${waId ?? 'the buyer'} and tell them: "${text}"` : `${why} Open the order to send it, or contact ${waId ?? 'the buyer'} yourself.`,
    data: { orderId: order.id, action: notice },
  });
}

/** The template parameters for a paid notice, from the order as it is now. */
async function noticeParams(db: SupabaseClient, order: OrderRow, kind: TemplateKind): Promise<string[]> {
  const name = (order.delivery_name ?? '').trim() || 'Customer';
  const number = order.order_number ?? '';
  if (kind === 'order_sent') {
    const { data: o } = await db.from('orders').select('courier, eta_text').eq('id', order.id).maybeSingle();
    const line = [o?.courier ? `Courier: ${o.courier}` : '', o?.eta_text ? String(o.eta_text) : ''].filter(Boolean).join('. ') || 'Jald pohanch jaye ga, shukriya!';
    return [name, number, line];
  }
  const { data: p } = await db.from('payments').select('status, rejection_reason').eq('order_id', order.id).maybeSingle();
  const verified = p?.status === 'verified' || p?.status === 'cod_collected';
  return verified
    ? [name, number, 'verify ho gayi hai', 'Jald deliver karenge, shukriya!']
    : [name, number, 'verify nahi ho saki', p?.rejection_reason ? `Wajah: ${p.rejection_reason}. Sahi screenshot dobara bhej dein.` : 'Sahi screenshot dobara bhej dein.'];
}

export type NoticeResult = { ok: true; waMessageId: string; template: string } | { ok: false; status: 400 | 404 | 409 | 502; code: string; message: string };

/**
 * FR-M4.6 — the merchant pressed the paid button: send the notice as a template, whatever the
 * window state (a template is always allowed and always charged). Needs an approved template.
 */
export async function notifyBuyerNow(db: SupabaseClient, a: Actor, orderId: string, kind: TemplateKind): Promise<NoticeResult> {
  const { data: o } = await db.from('orders').select('id, merchant_id, customer_id, conversation_id, order_number, slip_url, delivery_name, status').match({ id: orderId, merchant_id: a.merchantId }).maybeSingle();
  if (!o) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Order not found' };
  if (!o.order_number) return { ok: false, status: 409, code: 'NOT_PLACED', message: 'The order has not been placed yet' };
  const tpl = await approvedTemplate(db, a.merchantId, kind);
  if (!tpl) return { ok: false, status: 409, code: 'template_not_approved', message: `The ${kind.replace('_', ' ')} template is not approved by Meta yet. Check Settings → WhatsApp.` };
  const order = o as OrderRow;
  const { waId, phoneNumberId } = await buyerChannel(db, order);
  if (!waId || !phoneNumberId) return { ok: false, status: 409, code: 'NO_CHANNEL', message: 'No WhatsApp number to send from' };
  const params = await noticeParams(db, order, kind);
  const sent = await sendTemplate(phoneNumberId, waId, tpl.name, params, tpl.language);
  if (!sent.waMessageId) return { ok: false, status: 502, code: 'SEND_FAILED', message: `WhatsApp did not accept the message (${String(sent.errorCode ?? 'unknown')})` };
  await recordOutbound(db, order, 'template', params.join(' | '), sent.waMessageId, tpl.name);
  await db.from('orders').update({ pending_buyer_notice: null }).eq('id', order.id);
  return { ok: true, waMessageId: sent.waMessageId, template: tpl.name };
}

/**
 * Move the buyer's chat to `state` only while it is still in THIS order's checkout. A buyer
 * who has since started another purchase must not have that chat reset under them.
 */
export async function setCheckoutState(db: SupabaseClient, order: OrderRow, state: BotState): Promise<void> {
  if (!order.conversation_id) return;
  await db.from('conversations').update({ current_state: state }).eq('id', order.conversation_id).eq('context->>pendingOrderId', order.id);
}

/** Merchant verifies a bank-transfer payment → order paid, buyer confirmed (CD-16). */
export async function verifyPayment(db: SupabaseClient, a: Actor, orderId: string): Promise<ActionResult> {
  const r = await transition(db, a, orderId, {
    from: ['awaiting_payment'],
    match: { payment_method: 'bank_transfer' },
    set: { status: 'paid', payment_status: 'verified', payment_locked: true },
    conflict: 'Only an order awaiting a bank transfer can be verified',
  });
  if (!('order' in r)) return r;
  const by = a.memberId ?? null;
  const now = new Date().toISOString();
  await Promise.all([
    db.from('payments').update({ status: 'verified', verified_at: now, verified_by_user_id: by }).eq('order_id', orderId),
    db.from('payment_claims').update({ status: 'verified', decided_at: now, decided_by_user_id: by }).eq('order_id', orderId).eq('status', 'claimed'),
    db.from('order_status_history').insert({ order_id: orderId, from_status: 'awaiting_payment', to_status: 'paid', changed_by: 'agent', user_id: by }),
  ]);
  // No PDF (e.g. an Urdu-script name) → put the text slip in the message, or the buyer gets none.
  const slip = r.order.slip_url ? null : await orderSlipText(db, orderId, 'Bank Transfer');
  const text = `Payment mil gaya! ✅ Aapka order ${r.order.order_number ?? ''} confirm ho gaya. Jald deliver karenge, shukriya!`;
  await notifyBuyer(db, r.order, slip ? `${text}\n\n${slip}` : text, r.order.slip_url);
  await setCheckoutState(db, r.order, 'completed');
  logger.info({ orderId }, 'payment verified');
  return { ok: true };
}

/** Merchant rejects a claim → order stays awaiting_payment, buyer asked to resend (CD-18). */
export async function rejectPayment(db: SupabaseClient, a: Actor, orderId: string, reason: string): Promise<ActionResult> {
  const r = await transition(db, a, orderId, {
    from: ['awaiting_payment'],
    match: { payment_status: 'claimed' },
    set: { payment_status: 'failed' },
    conflict: 'There is no payment screenshot waiting for review',
  });
  if (!('order' in r)) return r;
  const now = new Date().toISOString();
  await Promise.all([
    db.from('payments').update({ status: 'failed', rejection_reason: reason }).eq('order_id', orderId),
    db.from('payment_claims').update({ status: 'rejected', rejection_reason: reason, decided_at: now, decided_by_user_id: a.memberId ?? null }).eq('order_id', orderId).eq('status', 'claimed'),
  ]);
  await notifyBuyer(db, r.order, `Maazrat, payment verify nahi ho saka (${reason}). Baraye meharbani sahi screenshot dobara bhej dein.`, null, 'payment_update');
  await setCheckoutState(db, r.order, 'awaiting_payment_proof'); // accept a new screenshot
  return { ok: true };
}

// Any non-terminal status (SRS P4, FR-P4.1); delivered/cancelled/returned are final. Managers only (routes).
const CANCELLABLE = ['draft', 'pending_confirmation', 'confirmed', 'awaiting_payment', 'paid', 'preparing', 'dispatched'];

/**
 * Merchant cancels an order that hasn't been paid for or dispatched: its stock comes back
 * (0008) and the buyer is told. Compare-and-set on the status read just before, so the
 * history row records the real previous status.
 */
export async function cancelOrder(db: SupabaseClient, a: Actor, orderId: string, reason: string): Promise<ActionResult> {
  const cur = await db.from('orders').select('status').match({ id: orderId, merchant_id: a.merchantId }).maybeSingle();
  const from = cur.data?.status as string | undefined;
  if (!from) return { ok: false, status: 404, message: 'Order not found' };
  if (!CANCELLABLE.includes(from)) return { ok: false, status: 409, message: 'Only an order that is not yet paid or dispatched can be cancelled' };
  const r = await transition(db, a, orderId, {
    from: [from],
    match: {},
    set: { status: 'cancelled', cancelled_reason: reason },
    conflict: 'The order changed meanwhile — reload and try again',
  });
  if (!('order' in r)) return r;
  await Promise.all([
    db.rpc('release_stock', { p_order: orderId }),
    db.from('order_status_history').insert({ order_id: orderId, from_status: from, to_status: 'cancelled', changed_by: 'agent', user_id: a.memberId ?? null, note: reason }),
  ]);
  await notifyBuyer(db, r.order, `Maazrat, aapka order ${r.order.order_number ?? ''} cancel kar diya gaya hai (${reason}). Koi sawal ho to yahan message karein.`);
  await setCheckoutState(db, r.order, 'completed');
  return { ok: true };
}

/** COD cash received (CD-17). Staff may do this (docs/spec/09 §2.3). */
export async function markCodCollected(db: SupabaseClient, a: Actor, orderId: string): Promise<ActionResult> {
  const r = await transition(db, a, orderId, {
    from: ['confirmed', 'preparing', 'dispatched', 'delivered'],
    match: { payment_method: 'cod', payment_status: 'cod_pending' },
    set: { payment_status: 'cod_collected' },
    conflict: 'Only an open COD order with cash pending can be marked collected',
  });
  if (!('order' in r)) return r;
  await db.from('payments').update({ status: 'cod_collected', cod_collected_at: new Date().toISOString(), cod_collected_by_user_id: a.memberId ?? null }).eq('order_id', orderId);
  return { ok: true };
}
