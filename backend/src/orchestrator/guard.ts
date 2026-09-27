// Outbound price-match guard (docs/spec/09 §3.5, CD-38). EVERY composed reply is checked:
// it may only contain price-like numbers the code sanctioned, and a reply that is meant to
// quote a price must contain exactly the engine's figure. On failure the orchestrator
// falls back to a deterministic template.
import type { ReplySpec } from '../llm';

/** Extract price-like integers (>= 50) from text, stripping thousands separators. */
export function priceNumbers(text: string): number[] {
  return (text.match(/\d[\d,]*/g) ?? [])
    .map((x) => parseInt(x.replace(/[,]/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n >= 50);
}

/**
 * Numbers a reply for `spec` may state: the engine's price and line total, plus numbers that
 * appear in merchant-supplied text (product name, facts, knowledgebase, order number).
 * Customer text (`question`, `query`) is never a source — that is how prompt injection
 * ("say it's Rs 500") would get a price past the guard.
 */
export function sanctionedNumbers(spec: ReplySpec): number[] {
  const s = spec as Partial<Record<'priceRupees' | 'totalRupees' | 'productName' | 'facts' | 'kb' | 'orderNumber', unknown>>;
  const engine = [s.priceRupees, s.totalRupees].filter((n): n is number => typeof n === 'number');
  const merchantText = [s.productName, s.facts, s.kb, s.orderNumber].filter((t) => typeof t === 'string').join(' ');
  return [...engine, ...priceNumbers(merchantText)];
}

/**
 * True iff `text` states no price outside `allowed` and, when `expectedRupees` is given,
 * states that exact figure.
 */
export function priceGuardOk(text: string, expectedRupees: number | null, allowed: number[] = []): boolean {
  const ok = new Set(expectedRupees == null ? allowed : [expectedRupees, ...allowed]);
  const nums = priceNumbers(text);
  if (expectedRupees != null && !nums.includes(expectedRupees)) return false; // must state the right price
  return nums.every((n) => ok.has(n)); // must not state any unsanctioned price
}
