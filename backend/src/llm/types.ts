// Provider-agnostic LLM interface. Swap Gemini/Claude/other by changing LLM_PROVIDER.
// The LLM ONLY (a) classifies intent + extracts the customer's offered number, and
// (b) phrases replies in Roman Urdu. It NEVER decides prices (docs/spec/06, 00 principle #1).
import type { BotIntent, Lang } from '@app/shared';

export interface Classification {
  intent: BotIntent;
  productQuery: string | null; // free-text product the customer referred to
  quantity: number | null;
  offerPaisa: number | null; // customer's offered price, converted to paisa
  offerScope: 'per_unit' | 'total' | null; // "2 shirts 3000 me" → total; "3000 per piece" → per_unit
  language: Lang;
}

export interface ClassifyContext {
  productNames: string[]; // catalog names, to help resolution
}

/** A structured instruction for what to say — the LLM only phrases it (Roman Urdu). */
export type ReplySpec =
  | { kind: 'greeting' }
  | { kind: 'quote'; productName: string; priceRupees: number; quantity?: number; totalRupees?: number }
  | { kind: 'counter'; productName: string; priceRupees: number; final?: boolean; quantity?: number; totalRupees?: number }
  | { kind: 'accept'; productName: string; priceRupees: number; quantity?: number; totalRupees?: number }
  | { kind: 'hold'; productName: string; priceRupees: number; quantity?: number; totalRupees?: number }
  | { kind: 'not_found'; query: string }
  | { kind: 'choose_product'; options: string[] } // the mention matched several products — ask which
  | { kind: 'out_of_stock'; productName: string }
  | { kind: 'limited_stock'; productName: string; available: number } // asked for more than is in stock
  | { kind: 'order_ack'; productName: string; priceRupees: number }
  | { kind: 'ask_delivery' } // after accept — ask name/address/area
  | { kind: 'ask_delivery_missing'; missing: string }
  | { kind: 'ask_payment_method'; priceRupees: number } // summary total + COD/bank?
  | { kind: 'bank_await' } // sent after bank details — ask for screenshot
  | { kind: 'payment_received' } // screenshot received, verifying
  | { kind: 'payment_verified'; orderNumber: string }
  | { kind: 'clarify' }
  | { kind: 'chitchat' }
  | { kind: 'handoff' }
  | { kind: 'upsell'; productName: string; priceRupees: number } // post-order add-on suggestion
  | { kind: 'product_answer'; productName: string; question: string; facts: string } // answer ONLY from facts
  | { kind: 'kb_answer'; question: string; kb: string }; // answer ONLY from the shop knowledgebase

/**
 * Procedural replies that always use the fixed Roman-Urdu template (orchestrator `fallbackText`).
 * They say the same thing every time, so an LLM call adds cost and latency but nothing else.
 */
export const TEMPLATE_ONLY_KINDS = [
  'ask_delivery', 'ask_delivery_missing', 'bank_await', 'payment_received', 'handoff',
  'clarify', 'not_found', 'choose_product', 'out_of_stock', 'limited_stock',
] as const;
/** The reply kinds that actually go to the LLM. */
export type ComposedSpec = Exclude<ReplySpec, { kind: (typeof TEMPLATE_ONLY_KINDS)[number] }>;
export const isTemplateOnly = (s: ReplySpec): s is Exclude<ReplySpec, ComposedSpec> =>
  (TEMPLATE_ONLY_KINDS as readonly string[]).includes(s.kind);

/** Merchant-selected bargaining personality — maps to concession presets + reply tone. */
export type BotStyle = 'narm' | 'standard' | 'sakht';

export interface ComposeContext {
  businessName: string;
  botName?: string;
  style?: BotStyle;
  language: Lang;
}

export interface DeliveryDetails {
  name: string | null;
  address: string | null;
  area: string | null;
  city: string | null;
  phone: string | null;
}

export class LlmUnavailableError extends Error {}

export interface LlmClient {
  classify(text: string, ctx: ClassifyContext): Promise<Classification>;
  compose(spec: ComposedSpec, ctx: ComposeContext): Promise<string>;
  extractDelivery(text: string): Promise<DeliveryDetails>;
  /** Transcribe a WhatsApp voice note to Roman Urdu text. Null when unintelligible/unavailable. */
  transcribeAudio(data: Buffer, mimeType: string): Promise<string | null>;
  /** Draft a short Roman-Urdu product description from a product photo. */
  describeImage(data: Buffer, mimeType: string, productName: string): Promise<string | null>;
}
