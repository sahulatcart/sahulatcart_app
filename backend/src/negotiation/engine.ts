// NegotiationEngine — pure, deterministic price decisions.
// docs/spec/06-negotiation-engine.md is normative. No I/O, no randomness, no clock.
// Every returned price is guaranteed within [floor, listPrice].
import type {
  NegotiationDecision,
  NegotiationDefaults,
  NegotiationInput,
  Paisa,
  ProductPricing,
} from './types';

// §10 constants
const ABSURDITY_RATIO = 0.1; // offers below 10% of list are absurd
const ACCEPT_BAND_MAX: Paisa = 5000; // Rs.50
const GOODWILL_CAP = 0.15; // small_goodwill opening gesture (fraction of gap)

// ── §7 primitives ──────────────────────────────────────────────────────────
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Round paisa to the nearest whole rupee (§7.5). */
export function roundToRupee(paisa: number): Paisa {
  return Math.round(paisa / 100) * 100;
}

function acceptBand(listPrice: Paisa): Paisa {
  return Math.min(roundToRupee(listPrice * 0.01), ACCEPT_BAND_MAX);
}

function highestBulkPct(product: ProductPricing, quantity: number): number {
  const tiers = product.bulkTiers ?? [];
  let pct = 0;
  for (const t of tiers) if (quantity >= t.minQty && t.extraDiscountPct > pct) pct = t.extraDiscountPct;
  return pct;
}

/** Effective per-product/merchant max discount % (pre-bulk), §3.1. */
function effectiveMaxDiscountPct(product: ProductPricing, defaults: NegotiationDefaults): number {
  return product.maxDiscountPct != null ? product.maxDiscountPct : defaults.maxDiscountPct ?? 0;
}

/** §3 floor computation — clamped, margin-guarded, rounded to rupee. */
export function computeFloor(
  product: ProductPricing,
  defaults: NegotiationDefaults,
  quantity: number
): Paisa {
  const list = product.price;
  if (!product.negotiable) return list;

  const effPct = effectiveMaxDiscountPct(product, defaults);
  const effectivePct = Math.min(effPct + highestBulkPct(product, quantity), 100);

  // min_price is absolute and wins over the pct path (§3.1).
  let base = product.minPrice != null ? product.minPrice : Math.round(list * (1 - effectivePct / 100));

  // margin guard can only RAISE the floor; inert if cost is null (§3.4).
  if (defaults.minMarginPct != null && product.cost != null) {
    const marginFloor = Math.round(product.cost * (1 + defaults.minMarginPct / 100));
    base = Math.max(base, marginFloor);
  }

  base = clamp(base, 0, list);
  return clamp(roundToRupee(base), 0, list);
}

/** §4.2/§4.3 concession curve — the bot's offer at a given (1-based) round. */
export function curveOffer(
  listPrice: Paisa,
  floor: Paisa,
  concessionSteps: number[],
  round: number,
  openingStance: NegotiationDefaults['openingStance'] = 'list_price'
): Paisa {
  const gap = listPrice - floor;
  if (gap <= 0) return listPrice;
  const idx = Math.min(Math.max(round, 1), concessionSteps.length) - 1;
  let cumFraction = concessionSteps[idx] ?? 1;
  if (openingStance === 'small_goodwill' && round === 1) {
    cumFraction = Math.min(concessionSteps[0] ?? GOODWILL_CAP, GOODWILL_CAP);
  }
  const raw = listPrice - gap * cumFraction;
  return clamp(roundToRupee(raw), floor, listPrice);
}

function decision(
  action: NegotiationDecision['action'],
  price: Paisa | undefined,
  audit: NegotiationDecision['audit'],
  extra: Partial<Pick<NegotiationDecision, 'final' | 'question' | 'reason'>> = {}
): NegotiationDecision {
  return { action, ...(price !== undefined ? { price } : {}), ...extra, audit };
}

/** The pure decision function (§4.6). */
export function decide(input: NegotiationInput): NegotiationDecision {
  const { product, defaults, history, customerOffer } = input;
  const list = product.price;
  const quantity = input.quantity ?? 1;
  const floor = computeFloor(product, defaults, quantity);
  const effPct = effectiveMaxDiscountPct(product, defaults);
  const auditBase = { floor, listPrice: list, effectiveMaxDiscountPct: effPct };
  const mkAudit = (round: number) => ({ ...auditBase, round });

  // Once agreed, the line is locked (§7.6).
  if (history.status === 'agreed') {
    return decision('HOLD', history.lastBotOffer ?? floor, mkAudit(history.rounds), {
      reason: 'agreed_locked',
    });
  }

  // Non-negotiable fast path (§3.2).
  if (!product.negotiable) {
    if (customerOffer != null && customerOffer >= list) return decision('ACCEPT', list, mkAudit(history.rounds));
    return decision('HOLD', list, mkAudit(history.rounds), { reason: 'non_negotiable' });
  }

  // Bulk needs a quantity we don't have yet.
  if ((product.bulkTiers?.length ?? 0) > 0 && input.quantity == null) {
    return decision('ASK', undefined, mkAudit(history.rounds), { question: 'confirm_quantity' });
  }

  const gap = list - floor;
  // Nothing to give.
  if (gap <= 0) {
    if (customerOffer != null && customerOffer >= list) return decision('ACCEPT', list, mkAudit(history.rounds));
    return decision('HOLD', list, mkAudit(history.rounds), { reason: 'no_discount_room' });
  }

  const currentBotCounter = curveOffer(list, floor, defaults.concessionSteps, history.rounds || 1);

  // Absurd offers (§7.4) — HOLD, do not advance the curve.
  if (customerOffer != null && (customerOffer <= 0 || customerOffer < ABSURDITY_RATIO * list)) {
    return decision('HOLD', currentBotCounter, mkAudit(history.rounds), { reason: 'absurd_offer' });
  }

  // ACCEPT branches (§4.4).
  if (customerOffer != null) {
    const offer = Math.min(customerOffer, list); // never overcharge above list
    if (offer >= list) return decision('ACCEPT', list, mkAudit(history.rounds));
    if (defaults.autoAcceptAtFloor && offer >= floor) return decision('ACCEPT', offer, mkAudit(history.rounds));
    if (offer >= currentBotCounter - acceptBand(list) && offer >= floor) {
      return decision('ACCEPT', offer, mkAudit(history.rounds));
    }
  }

  // Round cap / stalemate (§4.5).
  if (history.rounds >= defaults.roundsMax) {
    if (customerOffer != null && customerOffer >= floor) {
      return decision('ACCEPT', Math.min(customerOffer, list), mkAudit(history.rounds));
    }
    if (!history.finalOffered) {
      return decision('COUNTER', floor, mkAudit(history.rounds + 1), { final: true });
    }
    return decision('REJECT', undefined, mkAudit(history.rounds), { reason: 'stalemate' });
  }

  // Concede one step down the curve (§4.2/§4.3), monotonic, never below floor.
  const round = history.rounds + 1;
  let newCounter = curveOffer(list, floor, defaults.concessionSteps, round, defaults.openingStance);
  newCounter = Math.min(newCounter, currentBotCounter);
  return decision('COUNTER', newCounter, mkAudit(round));
}
