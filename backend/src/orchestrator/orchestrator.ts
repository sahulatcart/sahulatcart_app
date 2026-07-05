import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotState } from '@app/shared';
import { logger } from '../lib/logger';
import { decide } from '../negotiation';
import type { NegotiationDefaults, ProductPricing } from '../negotiation/types';
import { getLlmClient, LlmUnavailableError, type ComposeContext, type DeliveryDetails, type ReplySpec } from '../llm';
import { sendDocument, sendText } from '../whatsapp/client';
import { downloadWhatsAppMedia, uploadScreenshot } from '../whatsapp/media';
import { signedSlipUrl } from './slip';
import type { NormalizedMessage } from '../whatsapp/types';
import { resolveProduct, type CatalogItem } from './resolve';
import { priceGuardOk } from './guard';
import { confirmBankOrder, confirmCodOrder, createDraftOrder, type DeliveryInfo } from './order-service';

export interface OrchestratorCtx {
  merchantId: string;
  conversationId: string;
  phoneNumberId: string;
  customerId: string;
  customerWaId: string;
}

const rupees = (paisa: number): number => Math.round(paisa / 100);
const HOLD_MSG = 'Ek minute, abhi check kar ke bata deta hoon...';

const DEFAULT_NEGOTIATION: NegotiationDefaults = {
  maxDiscountPct: 0,
  concessionSteps: [0.5, 0.8, 1.0],
  roundsMax: 3,
  autoAcceptAtFloor: true,
};

function coerceDefaults(raw: unknown): NegotiationDefaults {
  const d = (raw ?? {}) as Partial<NegotiationDefaults>;
  return {
    maxDiscountPct: typeof d.maxDiscountPct === 'number' ? d.maxDiscountPct : 0,
    minMarginPct: d.minMarginPct,
    concessionSteps: Array.isArray(d.concessionSteps) && d.concessionSteps.length ? d.concessionSteps : DEFAULT_NEGOTIATION.concessionSteps,
    roundsMax: typeof d.roundsMax === 'number' ? d.roundsMax : 3,
    autoAcceptAtFloor: d.autoAcceptAtFloor !== false,
    openingStance: d.openingStance,
    stalemateAction: d.stalemateAction,
    bulkTiers: d.bulkTiers,
  };
}

// ── Deterministic Roman-Urdu fallbacks (used when the LLM is down or the price guard fails) ──
function fallbackText(spec: ReplySpec): string {
  switch (spec.kind) {
    case 'greeting': return 'Assalam-o-Alaikum! Kaise madad kar sakta hoon?';
    case 'quote': return `${spec.productName} ki price Rs ${spec.priceRupees} hai.`;
    case 'counter': return `${spec.productName} Rs ${spec.priceRupees} tak kar sakta hoon${spec.final ? ', ye last price hai' : ''}.`;
    case 'accept': return `Theek hai, ${spec.productName} Rs ${spec.priceRupees} final. Shukriya!`;
    case 'hold': return `Is se kam mushkil hai, ${spec.productName} Rs ${spec.priceRupees} hi best hai.`;
    case 'not_found': return `Maazrat, "${spec.query}" abhi available nahi. Kuch aur dikhaoon?`;
    case 'out_of_stock': return `Maazrat, ${spec.productName} abhi stock mein nahi.`;
    case 'order_ack': return `Bohat khoob! ${spec.productName} Rs ${spec.priceRupees}. Ab order details leta hoon.`;
    case 'ask_delivery': return 'Bohat khoob! Order ke liye apna poora naam, address aur area/shehar bhej dein.';
    case 'ask_delivery_missing': return `Aapka ${spec.missing} bhi bata dein taake delivery ho sake.`;
    case 'ask_payment_method': return `Aapke order ka total Rs ${spec.priceRupees} hai. Payment Cash on Delivery karenge ya bank transfer?`;
    case 'bank_await': return 'Amount transfer kar ke payment ka screenshot yahan bhej dein, shukriya.';
    case 'payment_received': return 'Screenshot mil gaya, verify kar ke abhi confirm karte hain.';
    case 'payment_verified': return `Order ${spec.orderNumber} confirm ho gaya. Shukriya!`;
    case 'clarify': return 'Zara batayein kaunsa product chahiye?';
    case 'chitchat': return 'Ji bilkul! Batayein kaise madad karoon?';
    case 'handoff': return 'Aapko humari team se connect kar raha hoon, thodi dair mein reply aayega.';
  }
}

/** Compose via LLM; enforce the price-match guard; fall back to a safe template. */
async function safeCompose(spec: ReplySpec, cc: ComposeContext): Promise<string> {
  const expected = 'priceRupees' in spec ? spec.priceRupees : null;
  try {
    const text = await getLlmClient().compose(spec, cc);
    if (expected != null && !priceGuardOk(text, expected)) {
      logger.warn({ spec: spec.kind, expected }, 'price-match guard tripped — using fallback');
      return fallbackText(spec);
    }
    return text || fallbackText(spec);
  } catch (e) {
    if (!(e instanceof LlmUnavailableError)) logger.error({ err: (e as Error).message }, 'compose error');
    return fallbackText(spec);
  }
}

// ── Negotiation persistence ──────────────────────────────────────────────────
async function getOrCreateNegotiation(db: SupabaseClient, ctx: OrchestratorCtx, p: CatalogItem, quantity: number) {
  const existing = await db
    .from('negotiations')
    .select('*')
    .eq('conversation_id', ctx.conversationId)
    .eq('product_id', p.id)
    .eq('status', 'ongoing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.data) return existing.data;
  const created = await db
    .from('negotiations')
    .insert({
      conversation_id: ctx.conversationId,
      merchant_id: ctx.merchantId,
      product_id: p.id,
      quantity,
      list_price: p.price,
      floor_price: p.price,
      rounds: 0,
      status: 'ongoing',
      final_offered: false,
    })
    .select('*')
    .single();
  if (created.error) logger.error({ err: created.error.message }, 'negotiation create failed');
  return created.data;
}

function toPricing(p: CatalogItem): ProductPricing {
  return {
    id: p.id,
    price: p.price,
    cost: p.cost,
    currency: 'PKR',
    negotiable: p.negotiable,
    maxDiscountPct: p.maxDiscountPct,
    minPrice: p.minPrice,
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function runOrchestrator(db: SupabaseClient, ctx: OrchestratorCtx, message: NormalizedMessage): Promise<void> {
  const merchantRes = await db
    .from('merchants')
    .select('business_name, bot_persona, negotiation_defaults, settings')
    .eq('id', ctx.merchantId)
    .single();
  const merchant = merchantRes.data;
  if (!merchant) return;

  const settings = (merchant.settings ?? {}) as { botEnabled?: boolean };
  if (settings.botEnabled === false) {
    logger.info({ merchantId: ctx.merchantId }, 'bot disabled — not replying');
    return;
  }

  const cc: ComposeContext = {
    businessName: merchant.business_name ?? 'Shop',
    botName: (merchant.bot_persona as { name?: string })?.name,
    language: 'roman_urdu',
  };
  const defaults = coerceDefaults(merchant.negotiation_defaults);

  const convoRes = await db.from('conversations').select('current_state, context, status, unread_count').eq('id', ctx.conversationId).single();
  // Human takeover: bot stays silent; message is already stored. Merchant replies from the inbox.
  if (convoRes.data?.status === 'human_takeover') {
    await db.from('conversations').update({ unread_count: ((convoRes.data as { unread_count?: number }).unread_count ?? 0) + 1 }).eq('id', ctx.conversationId);
    logger.info({ conversationId: ctx.conversationId }, 'human takeover — bot silent');
    return;
  }
  // After a finished order, the next inbound message starts a NEW shopping session:
  // drop stale product/negotiation/delivery context so we don't re-quote the old item.
  const context: Record<string, unknown> =
    convoRes.data?.current_state === 'completed' ? {} : ((convoRes.data?.context ?? {}) as Record<string, unknown>) || {};

  const catRes = await db
    .from('products')
    .select('id, name, price, cost, currency, negotiable, max_discount_pct, min_price, stock, track_stock')
    .eq('merchant_id', ctx.merchantId)
    .eq('is_active', true);
  const catalog: CatalogItem[] = (catRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    price: r.price,
    cost: r.cost,
    currency: 'PKR',
    negotiable: r.negotiable,
    maxDiscountPct: r.max_discount_pct,
    minPrice: r.min_price,
    stock: r.stock,
    trackStock: r.track_stock,
  }));

  const text = message.text ?? '';

  // ── Phase-4 order-flow states are handled WITHOUT a classify call (fewer LLM calls) ──
  const state = (convoRes.data?.current_state ?? 'greeting') as BotState;
  if (state === 'collecting_delivery') return handleDelivery(db, ctx, cc, context, merchant.settings, message);
  if (state === 'selecting_payment') return handlePayment(db, ctx, cc, context, message);
  if (state === 'awaiting_payment_proof') return handlePaymentProof(db, ctx, cc, context, message);

  // ── Shopping states: classify intent ──
  let cls;
  try {
    cls = await getLlmClient().classify(text, { productNames: catalog.map((c) => c.name) });
  } catch {
    // classification unavailable → hold & retry-next-message
    await reply(db, ctx, HOLD_MSG, 'greeting', context);
    return;
  }

  // Resolve product. Only carry the active item forward when the customer did NOT name a
  // new one — an explicit mention that doesn't match the catalog is "not found", never a
  // silent fallback to the previous product.
  const activeId = context.activeProductId as string | undefined;
  const mentioned = !!(cls.productQuery && cls.productQuery.trim());
  const product = resolveProduct(cls.productQuery, catalog) ?? (mentioned ? null : catalog.find((c) => c.id === activeId) ?? null);

  // ── Intent routing ──
  if (cls.intent === 'stop') {
    await db.from('customers').update({ wa_opt_in_status: 'out', wa_opt_in_at: new Date().toISOString() }).eq('id', ctx.customerId);
    await reply(db, ctx, 'Theek hai, aainda message nahi karenge. Shukriya!', 'completed', context);
    return;
  }
  if (cls.intent === 'human_request' || cls.intent === 'complaint') {
    await handoff(db, ctx, cc, context, convoRes.data?.current_state as BotState);
    return;
  }

  // A greeting or small talk is always just that — never quote a leftover active product.
  if (cls.intent === 'greet' || cls.intent === 'chitchat') {
    const spec: ReplySpec = cls.intent === 'greet' ? { kind: 'greeting' } : { kind: 'chitchat' };
    await reply(db, ctx, await safeCompose(spec, cc), 'browsing', context);
    return;
  }

  if (!product) {
    // wants a product/price but we couldn't resolve it
    if (['ask_product', 'ask_price', 'make_offer', 'add_to_order'].includes(cls.intent)) {
      const q = (cls.productQuery ?? text).trim();
      // Named something specific we don't carry → say it's unavailable; otherwise ask which.
      const spec: ReplySpec = mentioned || !catalog.length ? { kind: 'not_found', query: q } : { kind: 'clarify' };
      await reply(db, ctx, await safeCompose(spec, cc), 'browsing', context);
      return;
    }
    await reply(db, ctx, await safeCompose({ kind: 'clarify' }, cc), 'browsing', context);
    return;
  }

  // stock check
  if (product.trackStock && product.stock != null && product.stock <= 0) {
    await reply(db, ctx, await safeCompose({ kind: 'out_of_stock', productName: product.name }, cc), 'browsing', context);
    return;
  }

  const quantity = cls.quantity ?? 1;
  const neg = await getOrCreateNegotiation(db, ctx, product, quantity);
  const newContext = { ...context, activeProductId: product.id, activeNegotiationId: neg?.id };

  // Interest without an offer, first touch → QUOTE the list price (don't start haggling).
  if (['ask_price', 'ask_product', 'add_to_order'].includes(cls.intent) && cls.offerPaisa == null && (neg?.rounds ?? 0) === 0) {
    await reply(db, ctx, await safeCompose({ kind: 'quote', productName: product.name, priceRupees: rupees(product.price) }, cc), 'product_qa', newContext);
    return;
  }

  // Determine the customer's offer for the engine.
  let customerOffer: number | null = cls.offerPaisa;
  const mapIntent: 'offer' | 'wants_discount' | 'accepts' | 'other' =
    cls.intent === 'make_offer' ? 'offer' : cls.intent === 'accept' ? 'accepts' : cls.intent === 'reject' ? 'wants_discount' : 'other';
  if (cls.intent === 'accept' && customerOffer == null) customerOffer = neg?.last_bot_offer ?? product.price;
  if (cls.intent === 'ask_price' && customerOffer == null) customerOffer = null; // restate via HOLD path below

  const decision = decide({
    product: toPricing(product),
    defaults,
    quantity,
    history: {
      rounds: neg?.rounds ?? 0,
      lastBotOffer: neg?.last_bot_offer ?? null,
      lastCustomerOffer: neg?.last_customer_offer ?? null,
      finalOffered: neg?.final_offered ?? false,
      status: 'ongoing',
    },
    customerOffer,
    intent: mapIntent,
  });

  // Persist the round + map to a reply.
  let spec: ReplySpec;
  const nextState: BotState = 'negotiating';
  const negPatch: Record<string, unknown> = {
    floor_price: decision.audit.floor,
    last_customer_offer: customerOffer ?? neg?.last_customer_offer ?? null,
    quantity,
  };

  // ACCEPT → lock the deal and start the order flow (ask for delivery). CD-15/16.
  if (decision.action === 'ACCEPT') {
    await saveNeg(db, neg?.id, { ...negPatch, status: 'agreed', agreed_price: decision.price, last_bot_offer: decision.price });
    const dctx = { ...newContext, delivery: {} };
    await reply(db, ctx, await safeCompose({ kind: 'accept', productName: product.name, priceRupees: rupees(decision.price!) }, cc), 'collecting_delivery', dctx, false);
    await reply(db, ctx, await safeCompose({ kind: 'ask_delivery' }, cc), 'collecting_delivery', dctx);
    return;
  }

  switch (decision.action) {
    case 'COUNTER':
      spec = { kind: 'counter', productName: product.name, priceRupees: rupees(decision.price!), final: decision.final };
      Object.assign(negPatch, { rounds: decision.audit.round, last_bot_offer: decision.price, final_offered: (neg?.final_offered ?? false) || !!decision.final });
      break;
    case 'HOLD':
      spec = { kind: 'hold', productName: product.name, priceRupees: rupees(decision.price!) };
      break;
    case 'REJECT':
      await saveNeg(db, neg?.id, { ...negPatch, status: 'rejected' });
      await handoff(db, ctx, cc, newContext, 'negotiating');
      return;
    case 'ASK':
      spec = { kind: 'clarify' };
      break;
    default:
      spec = { kind: 'clarify' };
  }

  await saveNeg(db, neg?.id, negPatch);
  await reply(db, ctx, await safeCompose(spec, cc), nextState, newContext);
}

async function saveNeg(db: SupabaseClient, id: string | undefined, patch: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await db.from('negotiations').update(patch).eq('id', id);
}

async function handoff(db: SupabaseClient, ctx: OrchestratorCtx, cc: ComposeContext, context: Record<string, unknown>, resumeFrom: BotState | undefined): Promise<void> {
  await db
    .from('conversations')
    .update({ status: 'human_takeover', current_state: 'handoff', context: { ...context, resume_state: resumeFrom ?? 'greeting' } })
    .eq('id', ctx.conversationId);
  await db.from('notifications').insert({
    merchant_id: ctx.merchantId,
    type: 'takeover_request',
    title: 'Bot needs help',
    body: 'A conversation was handed off to a human.',
    data: { conversationId: ctx.conversationId },
    channel: 'portal',
  });
  await reply(db, ctx, await safeCompose({ kind: 'handoff' }, cc), 'handoff', context, /*updateState*/ false);
}

async function reply(
  db: SupabaseClient,
  ctx: OrchestratorCtx,
  text: string,
  nextState: BotState,
  context: Record<string, unknown>,
  updateState = true
): Promise<void> {
  const sent = await sendText(ctx.phoneNumberId, ctx.customerWaId, text);
  await db.from('messages').insert({
    conversation_id: ctx.conversationId,
    merchant_id: ctx.merchantId,
    direction: 'outbound',
    sender: 'bot',
    type: 'text',
    body: text,
    wa_message_id: sent.waMessageId,
    status: sent.waMessageId ? 'sent' : 'queued',
  });
  if (updateState) {
    await db.from('conversations').update({ current_state: nextState, context }).eq('id', ctx.conversationId);
  }
}

// ── Phase-4 state handlers ────────────────────────────────────────────────────

async function getDeliveryCharge(db: SupabaseClient, merchantId: string, area: string | null, settings: unknown): Promise<number> {
  if (area) {
    const z = await db.from('delivery_zones').select('charge').eq('merchant_id', merchantId).ilike('area_name', `%${area}%`).eq('is_serviceable', true).limit(1).maybeSingle();
    if (z.data) return z.data.charge as number;
  }
  const s = (settings ?? {}) as { defaultDeliveryCharge?: number };
  return typeof s.defaultDeliveryCharge === 'number' ? s.defaultDeliveryCharge : 0;
}

function bankDetailsText(bank: { bank_name: string; account_title: string; account_number: string; iban?: string | null }, totalRupees: number): string {
  return (
    `Payment ke liye humara account:\n` +
    `🏦 ${bank.bank_name}\n` +
    `👤 ${bank.account_title}\n` +
    `#️⃣ ${bank.account_number}` +
    (bank.iban ? `\nIBAN: ${bank.iban}` : '') +
    `\n💰 Amount: Rs ${totalRupees}`
  );
}

async function handleDelivery(db: SupabaseClient, ctx: OrchestratorCtx, cc: ComposeContext, context: Record<string, unknown>, settings: unknown, message: NormalizedMessage): Promise<void> {
  let ex: DeliveryDetails = { name: null, address: null, area: null, city: null, phone: null };
  try {
    ex = await getLlmClient().extractDelivery(message.text ?? '');
  } catch {
    /* keep empty → will ask again */
  }
  const prev = (context.delivery ?? {}) as Partial<DeliveryInfo>;
  const delivery: DeliveryInfo = {
    name: ex.name ?? prev.name ?? null,
    address: ex.address ?? prev.address ?? null,
    area: ex.area ?? prev.area ?? null,
    city: ex.city ?? prev.city ?? null,
    // Default to the customer's WhatsApp number (their real phone) if they didn't type one.
    phone: ex.phone ?? prev.phone ?? ctx.customerWaId ?? null,
  };
  const newCtx = { ...context, delivery };
  const missing = !delivery.name ? 'naam' : !delivery.address ? 'poora address' : !delivery.area ? 'area/shehar' : null;
  if (missing) {
    await reply(db, ctx, await safeCompose({ kind: 'ask_delivery_missing', missing }, cc), 'collecting_delivery', newCtx);
    return;
  }
  const charge = await getDeliveryCharge(db, ctx.merchantId, delivery.area, settings);
  const order = await createDraftOrder(db, ctx, delivery, charge);
  if (!order) {
    await reply(db, ctx, await safeCompose({ kind: 'clarify' }, cc), 'browsing', newCtx);
    return;
  }
  await reply(db, ctx, await safeCompose({ kind: 'ask_payment_method', priceRupees: rupees(order.total) }, cc), 'selecting_payment', { ...newCtx, pendingOrderId: order.orderId });
}

async function handlePayment(db: SupabaseClient, ctx: OrchestratorCtx, cc: ComposeContext, context: Record<string, unknown>, message: NormalizedMessage): Promise<void> {
  const orderId = context.pendingOrderId as string | undefined;
  if (!orderId) {
    await reply(db, ctx, await safeCompose({ kind: 'clarify' }, cc), 'browsing', context);
    return;
  }
  const txt = (message.text ?? '').toLowerCase();
  const wantsCod = /\bcod\b|cash|delivery pe|delivery par/.test(txt);
  const wantsBank = /bank|transfer|account|online/.test(txt);

  if (wantsCod) {
    const res = await confirmCodOrder(db, { merchantId: ctx.merchantId }, orderId, cc.businessName);
    const done = { ...context, pendingOrderId: undefined };
    if (res) {
      const url = res.slipKey ? await signedSlipUrl(db, res.slipKey) : null;
      const caption = `Order ${res.orderNumber} confirm ✅ COD par total Rs ${rupees(res.total)}. Jald deliver karenge, shukriya!`;
      if (url) {
        const sent = await sendDocument(ctx.phoneNumberId, ctx.customerWaId, url, `Order-${res.orderNumber}.pdf`, caption);
        await db.from('messages').insert({ conversation_id: ctx.conversationId, merchant_id: ctx.merchantId, direction: 'outbound', sender: 'bot', type: 'document', body: `[order slip] ${res.orderNumber}`, wa_message_id: sent.waMessageId, status: sent.waMessageId ? 'sent' : 'queued' });
        await db.from('conversations').update({ current_state: 'completed', context: done }).eq('id', ctx.conversationId);
      } else {
        await reply(db, ctx, res.slip, 'completed', done, false);
        await reply(db, ctx, caption, 'completed', done);
      }
    } else {
      await reply(db, ctx, await safeCompose({ kind: 'clarify' }, cc), 'browsing', done);
    }
    return;
  }
  if (wantsBank) {
    const bank = await db.from('bank_accounts').select('*').eq('merchant_id', ctx.merchantId).eq('is_active', true).order('is_default', { ascending: false }).limit(1).maybeSingle();
    if (!bank.data) {
      await reply(db, ctx, 'Maazrat, abhi sirf Cash on Delivery available hai. COD karein?', 'selecting_payment', context);
      return;
    }
    const res = await confirmBankOrder(db, { merchantId: ctx.merchantId }, orderId, bank.data.id, cc.businessName);
    if (!res) {
      await reply(db, ctx, await safeCompose({ kind: 'clarify' }, cc), 'browsing', context);
      return;
    }
    const bctx = { ...context, pendingOrderId: orderId, pendingPaymentId: res.paymentId, paymentMethod: 'bank_transfer' };
    await reply(db, ctx, bankDetailsText(bank.data, rupees(res.total)), 'awaiting_payment_proof', bctx, false);
    await reply(db, ctx, await safeCompose({ kind: 'bank_await' }, cc), 'awaiting_payment_proof', bctx);
    return;
  }
  const o = await db.from('orders').select('total').eq('id', orderId).single();
  await reply(db, ctx, await safeCompose({ kind: 'ask_payment_method', priceRupees: rupees(o.data?.total ?? 0) }, cc), 'selecting_payment', context);
}

async function handlePaymentProof(db: SupabaseClient, ctx: OrchestratorCtx, cc: ComposeContext, context: Record<string, unknown>, message: NormalizedMessage): Promise<void> {
  const orderId = context.pendingOrderId as string | undefined;
  if (message.type === 'image' && orderId) {
    // Download the screenshot from Meta → store privately in Supabase Storage → record the claim.
    const mediaId = (message.raw as { image?: { id?: string } })?.image?.id ?? null;
    const payRes = await db.from('payments').select('id, amount').eq('order_id', orderId).maybeSingle();
    const pid = (context.pendingPaymentId as string | undefined) ?? payRes.data?.id;
    const amount = payRes.data?.amount ?? 0;
    let ref: string | null = null;
    if (mediaId) {
      const media = await downloadWhatsAppMedia(mediaId);
      if (media) ref = await uploadScreenshot(db, ctx.merchantId, orderId, media.buffer, media.mimeType);
    }
    if (pid) {
      await db.from('payment_claims').insert({ payment_id: pid, order_id: orderId, merchant_id: ctx.merchantId, screenshot_url: ref, amount, status: 'claimed' });
      await db.from('payments').update({ status: 'claimed', claimed_at: new Date().toISOString(), screenshot_url: ref }).eq('id', pid);
      await db.from('orders').update({ payment_status: 'claimed' }).eq('id', orderId);
      await db.from('notifications').insert({ merchant_id: ctx.merchantId, type: 'payment_claim', title: 'Payment claim', body: 'Customer sent a payment screenshot — verify it.', data: { orderId, paymentId: pid }, channel: 'portal' });
    }
    await reply(db, ctx, await safeCompose({ kind: 'payment_received' }, cc), 'awaiting_payment_proof', context);
    return;
  }
  // no image yet → ask for the screenshot
  await reply(db, ctx, await safeCompose({ kind: 'bank_await' }, cc), 'awaiting_payment_proof', context);
}
