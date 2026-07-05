// NegotiationEngine types — docs/spec/06-negotiation-engine.md §9.
// Money is integer paisa everywhere.
import type { NegotiationDefaults } from '@app/shared';

export type Paisa = number;

export interface ProductPricing {
  id: string;
  price: Paisa; // list price
  cost: Paisa | null;
  currency: 'PKR';
  negotiable: boolean;
  maxDiscountPct: number | null; // per-product override
  minPrice: Paisa | null; // absolute floor
  bulkTiers?: { minQty: number; extraDiscountPct: number }[];
}

export interface NegotiationHistory {
  rounds: number; // bot counters made so far
  lastBotOffer: Paisa | null;
  lastCustomerOffer: Paisa | null;
  finalOffered: boolean;
  status: 'ongoing' | 'agreed' | 'rejected' | 'abandoned';
}

export interface NegotiationInput {
  product: ProductPricing;
  defaults: NegotiationDefaults;
  quantity: number | null;
  history: NegotiationHistory;
  customerOffer: Paisa | null; // LLM-extracted; null for a vague "kam karo"
  intent?: 'offer' | 'wants_discount' | 'accepts' | 'other';
}

export type NegotiationAction = 'ACCEPT' | 'COUNTER' | 'HOLD' | 'REJECT' | 'ASK';

export type NegotiationReason =
  | 'non_negotiable'
  | 'no_discount_room'
  | 'absurd_offer'
  | 'stalemate'
  | 'lowball'
  | 'agreed_locked'
  | 'no_offer';

export interface NegotiationDecision {
  action: NegotiationAction;
  price?: Paisa; // ACCEPT/COUNTER/HOLD — always in [floor, listPrice]
  final?: boolean; // last-chance floor offer
  question?: 'confirm_quantity';
  reason?: NegotiationReason;
  // Audit-only — persisted to negotiations, NEVER passed to the LLM/composer.
  audit: { floor: Paisa; listPrice: Paisa; round: number; effectiveMaxDiscountPct: number };
}

export type { NegotiationDefaults };
