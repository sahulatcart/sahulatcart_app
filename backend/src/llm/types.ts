// Provider-agnostic LLM interface. Swap Gemini/Claude/other by changing LLM_PROVIDER.
// The LLM ONLY (a) classifies intent + extracts the customer's offered number, and
// (b) phrases replies in Roman Urdu. It NEVER decides prices (docs/spec/06, 00 principle #1).
import type { BotIntent, Lang } from '@app/shared';

export interface Classification {
  intent: BotIntent;
  productQuery: string | null; // free-text product the customer referred to
  quantity: number | null;
  offerPaisa: number | null; // customer's offered price, converted to paisa
  language: Lang;
}

export interface ClassifyContext {
  productNames: string[]; // catalog names, to help resolution
}

/** A structured instruction for what to say — the LLM only phrases it (Roman Urdu). */
export type ReplySpec =
  | { kind: 'greeting' }
  | { kind: 'quote'; productName: string; priceRupees: number }
  | { kind: 'counter'; productName: string; priceRupees: number; final?: boolean }
  | { kind: 'accept'; productName: string; priceRupees: number }
  | { kind: 'hold'; productName: string; priceRupees: number }
  | { kind: 'not_found'; query: string }
  | { kind: 'out_of_stock'; productName: string }
  | { kind: 'order_ack'; productName: string; priceRupees: number } // Phase 4 placeholder
  | { kind: 'clarify' }
  | { kind: 'chitchat' }
  | { kind: 'handoff' };

export interface ComposeContext {
  businessName: string;
  botName?: string;
  language: Lang;
}

export class LlmUnavailableError extends Error {}

export interface LlmClient {
  classify(text: string, ctx: ClassifyContext): Promise<Classification>;
  compose(spec: ReplySpec, ctx: ComposeContext): Promise<string>;
}
