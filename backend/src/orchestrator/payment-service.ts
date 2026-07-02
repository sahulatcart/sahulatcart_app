import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger';
import { sendText } from '../whatsapp/client';

const rs = (paisa: number): string => `Rs ${Math.round(paisa / 100)}`;

interface OrderRow {
  id: string;
  merchant_id: string;
  customer_id: string;
  conversation_id: string | null;
  order_number: string | null;
  total: number;
  payment_status: string;
}

/** Load the buyer's WhatsApp channel (phone_number_id + wa_id) for an order and message them. */
async function notifyBuyer(db: SupabaseClient, order: OrderRow, text: string): Promise<void> {
  const cust = await db.from('customers').select('wa_id').eq('id', order.customer_id).single();
  const waId = cust.data?.wa_id;
  if (!waId) return;
  let phoneNumberId: string | undefined;
  let conversationId = order.conversation_id ?? undefined;
  if (conversationId) {
    const conv = await db.from('conversations').select('whatsapp_number_id').eq('id', conversationId).single();
    if (conv.data?.whatsapp_number_id) {
      const num = await db.from('whatsapp_numbers').select('phone_number_id').eq('id', conv.data.whatsapp_number_id).single();
      phoneNumberId = num.data?.phone_number_id;
    }
  }
  if (!phoneNumberId) {
    const num = await db.from('whatsapp_numbers').select('phone_number_id').eq('merchant_id', order.merchant_id).limit(1).maybeSingle();
    phoneNumberId = num.data?.phone_number_id;
  }
  if (!phoneNumberId) return;
  const sent = await sendText(phoneNumberId, waId, text);
  if (conversationId) {
    await db.from('messages').insert({
      conversation_id: conversationId,
      merchant_id: order.merchant_id,
      direction: 'outbound',
      sender: 'system',
      type: 'text',
      body: text,
      wa_message_id: sent.waMessageId,
      status: sent.waMessageId ? 'sent' : 'queued',
    });
    await db.from('conversations').update({ current_state: 'completed' }).eq('id', conversationId);
  }
}

async function loadOrder(db: SupabaseClient, orderId: string): Promise<OrderRow | null> {
  const r = await db.from('orders').select('id, merchant_id, customer_id, conversation_id, order_number, total, payment_status').eq('id', orderId).single();
  return (r.data as OrderRow) ?? null;
}

/** Merchant verifies a bank-transfer payment → order paid, buyer confirmed (CD-16). */
export async function verifyPayment(db: SupabaseClient, orderId: string, byUserId?: string): Promise<{ ok: boolean; error?: string }> {
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: 'order not found' };
  const now = new Date().toISOString();

  await db.from('payments').update({ status: 'verified', verified_at: now, verified_by_user_id: byUserId ?? null }).eq('order_id', orderId);
  const claim = await db.from('payment_claims').select('id').eq('order_id', orderId).eq('status', 'claimed').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (claim.data) await db.from('payment_claims').update({ status: 'verified', decided_at: now, decided_by_user_id: byUserId ?? null }).eq('id', claim.data.id);
  await db.from('orders').update({ status: 'paid', payment_status: 'verified', payment_locked: true }).eq('id', orderId);
  await db.from('order_status_history').insert({ order_id: orderId, from_status: 'awaiting_payment', to_status: 'paid', changed_by: 'agent', user_id: byUserId ?? null });

  await notifyBuyer(db, order, `Payment mil gaya! ✅ Aapka order ${order.order_number ?? ''} confirm ho gaya. Jald deliver karenge, shukriya!`);
  logger.info({ orderId }, 'payment verified');
  return { ok: true };
}

/** Merchant rejects a claim → stays awaiting_payment, buyer asked to resend (CD-18). */
export async function rejectPayment(db: SupabaseClient, orderId: string, reason: string, byUserId?: string): Promise<{ ok: boolean; error?: string }> {
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: 'order not found' };
  const now = new Date().toISOString();

  await db.from('payments').update({ status: 'failed', rejection_reason: reason }).eq('order_id', orderId);
  const claim = await db.from('payment_claims').select('id').eq('order_id', orderId).eq('status', 'claimed').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (claim.data) await db.from('payment_claims').update({ status: 'rejected', rejection_reason: reason, decided_at: now, decided_by_user_id: byUserId ?? null }).eq('id', claim.data.id);
  await db.from('orders').update({ payment_status: 'failed' }).eq('id', orderId);

  await notifyBuyer(db, order, `Maazrat, payment verify nahi ho saka (${reason}). Baraye meharbani sahi screenshot dobara bhej dein.`);
  // reopen the proof wait so a new screenshot is accepted
  if (order.conversation_id) await db.from('conversations').update({ current_state: 'awaiting_payment_proof' }).eq('id', order.conversation_id);
  return { ok: true };
}

/** Merchant marks COD cash collected (CD-17). */
export async function markCodCollected(db: SupabaseClient, orderId: string, byUserId?: string): Promise<{ ok: boolean; error?: string }> {
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: 'order not found' };
  const now = new Date().toISOString();
  await db.from('payments').update({ status: 'cod_collected', cod_collected_at: now, cod_collected_by_user_id: byUserId ?? null }).eq('order_id', orderId);
  await db.from('orders').update({ payment_status: 'cod_collected' }).eq('id', orderId);
  return { ok: true };
}
