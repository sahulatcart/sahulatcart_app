import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger';
import { rs } from '../lib/money';
import { formatPkt, generateSlipPdf, isPdfSafe, uploadSlip, type SlipData } from './slip';

export interface DeliveryInfo {
  name: string | null;
  address: string | null;
  area: string | null;
  city: string | null;
  phone: string | null;
}

/** The orders columns a placed order carries into its slip and confirmation. */
interface OrderRow {
  order_number: string;
  subtotal: number;
  discount_total: number;
  delivery_charge: number;
  total: number;
  delivery_name: string | null;
  delivery_address: string | null;
  delivery_area: string | null;
  delivery_city: string | null;
  delivery_phone: string | null;
  placed_at: string | null;
  created_at: string;
}
type Placed = { orderNumber: string; total: number; slip: string; slipKey: string | null };
/** Placement failed because a tracked item sold out between the deal and checkout. */
export const OUT_OF_STOCK = 'out_of_stock' as const;

async function nextOrderNumber(db: SupabaseClient, merchantId: string): Promise<string | null> {
  const { data, error } = await db.rpc('next_order_number', { p_merchant: merchantId });
  if (error || !data) logger.error({ err: error?.message, merchantId }, 'order number allocation failed');
  return (data as string | null) ?? null;
}

/**
 * Promote a DRAFT order to a placed one. The number comes from an atomic per-merchant
 * counter (db/migrations/0006), and the `status = 'draft'` filter makes this idempotent:
 * a repeated "cod", or a draft that was cancelled meanwhile, updates nothing → null.
 * The order's items then leave stock (0008), all or nothing; if one sold out meanwhile the
 * order is cancelled again and OUT_OF_STOCK returned.
 */
async function placeDraft(db: SupabaseClient, merchantId: string, orderId: string, set: Record<string, string>): Promise<OrderRow | typeof OUT_OF_STOCK | null> {
  const orderNumber = await nextOrderNumber(db, merchantId);
  if (!orderNumber) return null;
  const { data, error } = await db
    .from('orders')
    .update({ ...set, order_number: orderNumber, placed_at: new Date().toISOString() })
    .match({ id: orderId, merchant_id: merchantId, status: 'draft' })
    .select('*')
    .maybeSingle();
  if (error) logger.error({ err: error.message, orderId }, 'order placement failed');
  if (!data) return null;
  const stock = await db.rpc('reserve_stock', { p_order: orderId });
  if (stock.error) logger.error({ err: stock.error.message, orderId }, 'stock reservation failed — order kept'); // e.g. 0008 not applied
  if (stock.data === false) {
    await Promise.all([
      db.from('orders').update({ status: 'cancelled', cancelled_reason: 'out of stock at checkout' }).eq('id', orderId),
      db.from('order_status_history').insert({ order_id: orderId, from_status: set.status, to_status: 'cancelled', changed_by: 'bot', note: 'out of stock at checkout' }),
    ]);
    return OUT_OF_STOCK;
  }
  return data as OrderRow;
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

  // Skip negotiations already turned into a previous order in this chat, so a second
  // order in the same conversation doesn't re-include items the customer already bought.
  const negIds = rows.map((n) => n.id);
  const used = await db.from('order_items').select('negotiation_id').in('negotiation_id', negIds);
  const usedSet = new Set((used.data ?? []).map((i) => i.negotiation_id as string));
  const freshRows = rows.filter((n) => !usedSet.has(n.id));
  if (!freshRows.length) return null;

  let subtotal = 0;
  let discountTotal = 0;
  const items = freshRows.map((n) => {
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
  if (itemsRes.error) {
    // An order with a total but no lines must never reach the customer — drop the empty draft.
    logger.error({ err: itemsRes.error.message, orderId }, 'order_items insert failed');
    await db.from('orders').delete().eq('id', orderId).eq('status', 'draft');
    return null;
  }

  return { orderId, subtotal, discount: discountTotal, total };
}

/** Build a plain-text order slip (Roman Urdu labels) for WhatsApp. */
export function buildSlipText(o: SlipData): string {
  const lines: string[] = [];
  lines.push(`🧾 *${o.businessName}* — Order ${o.orderNumber}`);
  const when = formatPkt(o.placedAt);
  if (when) lines.push(`🗓 ${when}`);
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
export async function confirmCodOrder(db: SupabaseClient, ctx: { merchantId: string }, orderId: string, businessName: string): Promise<Placed | typeof OUT_OF_STOCK | null> {
  const order = await placeDraft(db, ctx.merchantId, orderId, { status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending' });
  if (!order || order === OUT_OF_STOCK) return order;
  await Promise.all([
    db.from('payments').insert({ order_id: orderId, merchant_id: ctx.merchantId, method: 'cod', amount: order.total, status: 'cod_pending' }),
    db.from('order_status_history').insert({ order_id: orderId, from_status: 'draft', to_status: 'confirmed', changed_by: 'bot' }),
    notifyNewOrder(db, ctx.merchantId, orderId, order, `New COD order ${order.order_number}`, 'cod'),
  ]);
  return placed(db, ctx.merchantId, orderId, businessName, order, 'Cash on Delivery');
}

/** Confirm a draft order for bank transfer: number, awaiting_payment, unpaid payments row. */
export async function confirmBankOrder(
  db: SupabaseClient,
  ctx: { merchantId: string },
  orderId: string,
  bankAccountId: string,
  businessName: string
): Promise<{ orderNumber: string; total: number; paymentId: string } | typeof OUT_OF_STOCK | null> {
  const order = await placeDraft(db, ctx.merchantId, orderId, { status: 'awaiting_payment', payment_method: 'bank_transfer', payment_status: 'unpaid' });
  if (!order || order === OUT_OF_STOCK) return order;
  const [pay] = await Promise.all([
    db.from('payments').insert({ order_id: orderId, merchant_id: ctx.merchantId, method: 'bank_transfer', amount: order.total, status: 'unpaid', bank_account_id: bankAccountId }).select('id').single(),
    db.from('order_status_history').insert({ order_id: orderId, from_status: 'draft', to_status: 'awaiting_payment', changed_by: 'bot' }),
    notifyNewOrder(db, ctx.merchantId, orderId, order, `New bank order ${order.order_number}`, 'bank_transfer', 'awaiting payment'),
  ]);
  await finalizeSlip(db, ctx.merchantId, orderId, businessName, order, 'Bank Transfer'); // stored now; sent to the buyer on verify
  return { orderNumber: order.order_number, total: order.total, paymentId: pay.data?.id ?? '' };
}

/** Switch a bank-transfer order (awaiting_payment) to COD — customer changed their mind before paying. */
export async function switchBankOrderToCod(db: SupabaseClient, ctx: { merchantId: string }, orderId: string, businessName: string): Promise<Placed | null> {
  const { data, error } = await db
    .from('orders')
    .update({ status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending' })
    .match({ id: orderId, merchant_id: ctx.merchantId, status: 'awaiting_payment' })
    .select('*')
    .maybeSingle();
  if (error) logger.error({ err: error.message, orderId }, 'switch to COD failed');
  const order = data as OrderRow | null;
  if (!order) return null;
  await Promise.all([
    db.from('payments').update({ method: 'cod', status: 'cod_pending' }).eq('order_id', orderId),
    db.from('order_status_history').insert({ order_id: orderId, from_status: 'awaiting_payment', to_status: 'confirmed', changed_by: 'customer' }),
    notifyNewOrder(db, ctx.merchantId, orderId, order, `Order ${order.order_number} switched to COD`, 'cod', 'customer chose cash on delivery instead of bank transfer'),
  ]);
  return placed(db, ctx.merchantId, orderId, businessName, order, 'Cash on Delivery');
}

function notifyNewOrder(db: SupabaseClient, merchantId: string, orderId: string, order: OrderRow, title: string, paymentMethod: string, note = order.delivery_name ?? 'customer') {
  return db.from('notifications').insert({
    merchant_id: merchantId,
    type: 'new_order',
    title,
    body: `${rs(order.total)} — ${note}`,
    data: { orderId, orderNumber: order.order_number, paymentMethod },
    channel: 'portal',
  });
}

async function placed(db: SupabaseClient, merchantId: string, orderId: string, businessName: string, order: OrderRow, paymentLabel: string): Promise<Placed> {
  const { text, key } = await finalizeSlip(db, merchantId, orderId, businessName, order, paymentLabel);
  return { orderNumber: order.order_number, total: order.total, slip: text, slipKey: key };
}

type ItemRow = { name_snapshot: string; quantity: number; line_total: number };

function slipData(order: OrderRow, businessName: string, items: ItemRow[], paymentLabel: string): SlipData {
  return {
    orderNumber: order.order_number,
    placedAt: order.placed_at ?? order.created_at,
    businessName,
    items: items.map((i) => ({ name: i.name_snapshot, qty: i.quantity, lineTotal: i.line_total })),
    subtotal: order.subtotal,
    discount: order.discount_total,
    deliveryCharge: order.delivery_charge,
    total: order.total,
    delivery: { name: order.delivery_name, address: order.delivery_address, area: order.delivery_area, city: order.delivery_city, phone: order.delivery_phone },
    paymentLabel,
  };
}

/** The WhatsApp text slip of a placed order — for buyers who got no PDF (e.g. an Urdu-script name). */
export async function orderSlipText(db: SupabaseClient, orderId: string, paymentLabel: string): Promise<string | null> {
  const [o, items] = await Promise.all([
    db.from('orders').select('*, merchants(business_name)').eq('id', orderId).maybeSingle(),
    db.from('order_items').select('name_snapshot, quantity, line_total').eq('order_id', orderId),
  ]);
  const order = o.data as (OrderRow & { merchants?: { business_name?: string } | null }) | null;
  if (!order?.order_number) return null;
  return buildSlipText(slipData(order, order.merchants?.business_name ?? 'Shop', (items.data ?? []) as ItemRow[], paymentLabel));
}

/** Build the text + PDF slip for an order, store the PDF, save order.slip_url. */
async function finalizeSlip(db: SupabaseClient, merchantId: string, orderId: string, businessName: string, order: OrderRow, paymentLabel: string): Promise<{ text: string; key: string | null }> {
  const itemsRes = await db.from('order_items').select('name_snapshot, quantity, line_total').eq('order_id', orderId);
  const sd = slipData(order, businessName, (itemsRes.data ?? []) as ItemRow[], paymentLabel);
  let key: string | null = null; // no PDF → callers send the text slip
  try {
    if (isPdfSafe(sd)) key = await uploadSlip(db, merchantId, orderId, await generateSlipPdf(sd));
    if (key) await db.from('orders').update({ slip_url: key }).eq('id', orderId);
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'slip pdf failed');
  }
  return { text: buildSlipText(sd), key };
}
