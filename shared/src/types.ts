// Shared DTO / JSON-shape types — mirror docs/spec/02-data-model.md.
// Money is ALWAYS integer paisa (1 PKR = 100 paisa).

import type { BotState, Lang } from './enums';

export type Paisa = number;
export type UUID = string;

/** merchants.negotiation_defaults — canonical shape (doc 02 / doc 06). */
export interface NegotiationDefaults {
  maxDiscountPct: number;
  minMarginPct?: number;
  /** cumulative FRACTIONS 0→1 of the list→floor gap, per round */
  concessionSteps: number[];
  roundsMax: number;
  autoAcceptAtFloor: boolean;
  openingStance?: 'list_price' | 'small_goodwill';
  stalemateAction?: 'handoff' | 'hold_and_close';
  bulkTiers?: { minQty: number; extraDiscountPct: number }[];
}

/** merchants.settings — canonical shape (doc 02 CD-13). */
export interface MerchantSettings {
  botEnabled: boolean;
  codEnabled: boolean;
  paymentInstructions: string;
  defaultDeliveryCharge: Paisa;
  freeDeliveryThreshold: Paisa;
  lowStockThreshold: number;
  onboardingCompletedAt: string | null;
  metaCatalog: {
    catalogId: string;
    connected: boolean;
    tokenRef: string;
    lastSyncedAt: string;
  } | null;
  notificationPrefs?: NotificationPrefs;
}

export interface NotificationPrefs {
  // per-type channel toggles; quiet hours in merchant tz
  [notificationType: string]: unknown;
}

/** conversations.context — canonical working-memory shape (doc 02 / doc 05 §1.3). */
export interface ConversationContext {
  resume_state?: BotState;
  activeProductId?: UUID;
  activeNegotiationId?: UUID;
  cart?: {
    productId: UUID;
    name: string;
    qty: number;
    unitPrice: Paisa;
    agreedPrice?: Paisa;
  }[];
  delivery?: { name?: string; address?: string; area?: string; city?: string };
  paymentMethod?: 'cod' | 'bank_transfer';
  pendingOrderId?: UUID;
  pendingPaymentId?: UUID;
  misunderstandCount?: number;
  flags?: Record<string, unknown>;
}

/** bot_persona — merchant-tunable voice (doc 02). */
export interface BotPersona {
  name?: string;
  greeting?: string;
  tone?: string;
  language?: Lang;
}

/** Standard API error envelope (doc 03 §1). */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
