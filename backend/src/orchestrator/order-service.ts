import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger';
import { generateSlipPdf, uploadSlip } from './slip';

export interface DeliveryInfo {
  name: string | null;
  address: string | null;
  area: string | null;
  city: string | null;
  phone: string | null;
}

const rs = (paisa: number): string => `Rs ${Math.round(paisa / 100)}`;

/** Human-friendly order number, unique-ish per merchant (pilot). */
async function nextOrderNumber(db: SupabaseClient, merchantId: string): Promise<string> {
  const { count } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .not('order_number', 'is', null);
  return `SK-${1000 + (count ?? 0) + 1}`;
}

/**
 * Materialize a draft order from the conversation's AGREED negotiations.
 * order_items use list price + negotiated discount (docs/spec/06 §6.2).
 */
export async function createDraftOrder(
  db: SupabaseClient,
  ctx: { merchantId: string; customerId: string; conversationId: string },
  delivery: DeliveryInfo,
  deliveryCharge: number
): Promise<{ orderId: string; subtotal: number; discount: number; total: number } | null> {
  const negs = await db
    .from('negotiations')
    .select('id, product_id, quantity, list_price, agreed_price, products(name)')
    .eq('conversation_id', ctx.conversationId)
    .eq('status', 'agreed');
  const rows = negs.data ?? [];
  if (!rows.length) return null;

  let subtotal = 0;
  let discountTotal = 0;
  const items = rows.map((n) => {
    const qty = n.quantity ?? 1;
    const list = n.list_price as number;
    const agreed = (n.agreed_price ?? list) as number;
    const lineDiscount = Math.max(0, (list - agreed) * qty);
    const lineTotal = agreed * qty;
    subtotal += list * qty;
    discountTotal += lineDiscount;
    return {
      merchant_id: ctx.merchantId,
      product_id: n.product_id,
      name_snapshot: (n.products as { name?: string } | null)?.name ?? 'Item',
      unit_price: list,
      quantity: qty,
      discount: lineDiscount,
      negotiated_discount: lineDiscount,
      discount_source: 'negotiated' as const,
      negotiation_id: n.id,
      line_total: lineTotal,
    };
  });
  const total = subtotal - discountTotal + deliveryCharge;

  const orderRes = await db
    .from('orders')
    .insert({
      merchant_id: ctx.merchantId,
      customer_id: ctx.customerId,
      conversation_id: ctx.conversationId,
      status: 'draft',
      subtotal,
      discount_total: discountTotal,
      delivery_charge: deliveryCharge,
      total,
      delivery_name: delivery.name,
      delivery_phone: delivery.phone,
      delivery_address: delivery.address,
      delivery_area: delivery.area,
      delivery_city: delivery.city,
    })
    .select('id')
    .single();
  if (orderRes.error || !orderRes.data) {
    logger.error({ err: orderRes.error?.message }, 'order create failed');
    return null;
  }
  const orderId = orderRes.data.id;
  const itemsRes = await db.from('order_items').insert(items.map((i) => ({ ...i, order_id: orderId })));
  if (itemsRes.error) logger.error({ err: itemsRes.error.message }, 'order_items insert failed');

  return { orderId, subtotal, discount: discountTotal, total };
}

/** Build a plain-text order slip (Roman Urdu labels) for WhatsApp. */
export function buildSlipText(o: {
  orderNumber: string;
  businessName: string;
  items: { name: string; qty: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  delivery: DeliveryInfo;
  paymentLabel: string;
}): string {
  const lines: string[] = [];
  lines.push(`🧾 *${o.businessName}* — Order ${o.orderNumber}`);
  lines.push('');
  for (const it of o.items) lines.push(`• ${it.name} x${it.qty} — ${rs(it.lineTotal)}`);
  lines.push('');
  if (o.discount > 0) lines.push(`Discount: -${rs(o.discount)}`);
  lines.push(`Delivery: ${o.deliveryCharge > 0 ? rs(o.deliveryCharge) : 'Free'}`);
  lines.push(`*Total: ${rs(o.total)}*`);
  lines.push('');
  lines.push(`📦 ${o.delivery.name ?? ''}`);
  lines.push(`${o.delivery.address ?? ''}${o.delivery.area ? ', ' + o.delivery.area : ''}${o.delivery.city ? ', ' + o.delivery.city : ''}`);
  lines.push(`💵 ${o.paymentLabel}`);
  return lines.join('\n');
}

/** Confirm a draft order as COD: number, status, payments row, slip, notification. */
export async function confirmCodOrder(
  db: SupabaseClient,
  ctx: { merchantId: string },
  orderId: string,
  businessName: string
): Promise<{ orderNumber: string; total: number; slip: string; slipKey: string | null } | null> {
  const orderRes = await db.from('orders').select('*').eq('id', orderId).single();
  const order = orderRes.data;
  if (!order) return null;

  const orderNumber = await nextOrderNumber(db, ctx.merchantId);
  await db
    .from('orders')
    .update({ status: 'confirmed', order_number: orderNumber, payment_method: 'cod', payment_status: 'cod_pending', placed_at: new Date().toISOString() })
    .eq('id', orderId);
  await db.from('payments').insert({ order_id: orderId, merchant_id: ctx.merchantId, method: 'cod', amount: order.total, status: 'cod_pending' });
  await db.from('order_status_history').insert({ order_id: orderId, from_status: 'draft', to_status: 'confirmed', changed_by: 'bot' });
  await db.from('notifications').insert({
    merchant_id: ctx.merchantId,
    type: 'new_order',
    title: `New COD order ${orderNumber}`,
    body: `${rs(order.total)} — ${order.delivery_name ?? 'customer'}`,
    data: { orderId, orderNumber, paymentMethod: 'cod' },
    channel: 'portal',
  });

  const { text, key } = await finalizeSlip(db, ctx.merchantId, orderId, orderNumber, businessName, order, 'Cash on Delivery');
  return { orderNumber, total: order.total, slip: text, slipKey: key };
}

/** Build the text + PDF slip for an order, store the PDF, save order.slip_url. */
export async function finalizeSlip(
  db: SupabaseClient,
  merchantId: string,
  orderId: string,
  orderNumber: string,
  businessName: string,
  order: { subtotal: number; discount_total: number; delivery_charge: number; total: number; delivery_name: string | null; delivery_address: string | null; delivery_area: string | null; delivery_city: string | null; delivery_phone: string | null },
  paymentLabel: string
): Promise<{ text: string; key: string | null }> {
  const itemsRes = await db.from('order_items').select('name_snapshot, quantity, line_total').eq('order_id', orderId);
  const items = (itemsRes.data ?? []).map((i) => ({ name: i.name_snapshot, qty: i.quantity, lineTotal: i.line_total }));
  const sd = {
    orderNumber,
    businessName,
    items,
    subtotal: order.subtotal,
    discount: order.discount_total,
    deliveryCharge: order.delivery_charge,
    total: order.total,
    delivery: { name: order.delivery_name, address: order.delivery_address, area: order.delivery_area, city: order.delivery_city, phone: order.delivery_phone },
    paymentLabel,
  };
  const text = buildSlipText(sd);
  let key: string | null = null;
  try {
    key = await uploadSlip(db, merchantId, orderId, await generateSlipPdf(sd));
    if (key) await db.from('orders').update({ slip_url: key }).eq('id', orderId);
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'slip pdf failed');
  }
  return { text, key };
}

/** Confirm a draft order for bank transfer: number, awaiting_payment, unpaid payments row. */
export async function confirmBankOrder(
  db: SupabaseClient,
  ctx: { merchantId: string },
  orderId: string,
  bankAccountId: string,
  businessName = 'Shop'
): Promise<{ orderNumber: string; total: number; paymentId: string } | null> {
  const orderRes = await db.from('orders').select('*').eq('id', orderId).single();
  if (!orderRes.data) return null;
  const orderNumber = await nextOrderNumber(db, ctx.merchantId);
  await db
    .from('orders')
    .update({ status: 'awaiting_payment', order_number: orderNumber, payment_method: 'bank_transfer', payment_status: 'unpaid', placed_at: new Date().toISOString() })
    .eq('id', orderId);
  const pay = await db
    .from('payments')
    .insert({ order_id: orderId, merchant_id: ctx.merchantId, method: 'bank_transfer', amount: orderRes.data.total, status: 'unpaid', bank_account_id: bankAccountId })
    .select('id')
    .single();
  await db.from('order_status_history').insert({ order_id: orderId, from_status: 'draft', to_status: 'confirmed', changed_by: 'bot' });
  await db.from('order_status_history').insert({ order_id: orderId, from_status: 'confirmed', to_status: 'awaiting_payment', changed_by: 'bot' });
  await db.from('notifications').insert({
    merchant_id: ctx.merchantId,
    type: 'new_order',
    title: `New bank order ${orderNumber}`,
    body: `${rs(orderRes.data.total)} — awaiting payment`,
    data: { orderId, orderNumber, paymentMethod: 'bank_transfer' },
    channel: 'portal',
  });
  await finalizeSlip(db, ctx.merchantId, orderId, orderNumber, businessName, orderRes.data, 'Bank Transfer'); // stores slip_url; sent to buyer on verify
  return { orderNumber, total: orderRes.data.total, paymentId: pay.data?.id ?? '' };
}
