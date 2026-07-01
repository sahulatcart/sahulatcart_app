import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotState } from '@app/shared';
import { logger } from '../lib/logger';
import { decide } from '../negotiation';
import type { NegotiationDefaults, ProductPricing } from '../negotiation/types';
import { getLlmClient, LlmUnavailableError, type ComposeContext, type ReplySpec } from '../llm';
import { sendText } from '../whatsapp/client';
import type { NormalizedMessage } from '../whatsapp/types';
import { resolveProduct, type CatalogItem } from './resolve';
import { priceGuardOk } from './guard';

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

  const convoRes = await db.from('conversations').select('current_state, context').eq('id', ctx.conversationId).single();
  const context = ((convoRes.data?.context ?? {}) as Record<string, unknown>) || {};

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
  let cls;
  try {
    cls = await getLlmClient().classify(text, { productNames: catalog.map((c) => c.name) });
  } catch {
    // classification unavailable → hold & retry-next-message
    await reply(db, ctx, HOLD_MSG, 'greeting', context);
    return;
  }

  // Resolve product: explicit mention → else the active one in context.
  const activeId = context.activeProductId as string | undefined;
  const product = resolveProduct(cls.productQuery, catalog) ?? catalog.find((c) => c.id === activeId) ?? null;

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

  if (['greet', 'chitchat'].includes(cls.intent) && !product) {
    const spec: ReplySpec = cls.intent === 'greet' ? { kind: 'greeting' } : { kind: 'chitchat' };
    await reply(db, ctx, await safeCompose(spec, cc), 'browsing', context);
    return;
  }

  if (!product) {
    // wants a product/price but we couldn't resolve it
    if (['ask_product', 'ask_price', 'make_offer'].includes(cls.intent)) {
      const q = cls.productQuery ?? text;
      const spec: ReplySpec = catalog.length ? { kind: 'clarify' } : { kind: 'not_found', query: q };
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

  // Pure price question, first touch → QUOTE the list price (don't start haggling).
  if (cls.intent === 'ask_price' && cls.offerPaisa == null && (neg?.rounds ?? 0) === 0) {
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
  let nextState: BotState = 'negotiating';
  const negPatch: Record<string, unknown> = {
    floor_price: decision.audit.floor,
    last_customer_offer: customerOffer ?? neg?.last_customer_offer ?? null,
    quantity,
  };

  switch (decision.action) {
    case 'ACCEPT':
      spec = { kind: 'accept', productName: product.name, priceRupees: rupees(decision.price!) };
      Object.assign(negPatch, { status: 'agreed', agreed_price: decision.price, last_bot_offer: decision.price });
      nextState = 'confirming';
      break;
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
