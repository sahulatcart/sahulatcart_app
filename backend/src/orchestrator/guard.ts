// Outbound price-match guard (docs/spec/09 §3.5, CD-38). A composed message that
// quotes a price MUST contain exactly the engine's figure and no other price-like
// number. On failure the orchestrator falls back to a deterministic template.

/** Extract price-like integers (>= 50) from text, stripping thousands separators. */
export function priceNumbers(text: string): number[] {
  return (text.match(/\d[\d,]*/g) ?? [])
    .map((x) => parseInt(x.replace(/[,]/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n >= 50);
}

/**
 * True iff `text` quotes exactly `expectedRupees` and no price outside the sanctioned
 * set. `alsoAllowed` covers engine-derived companions of the unit price (e.g. the
 * line total for "3 shirts" = unit × qty) — still never an LLM-invented number.
 */
export function priceGuardOk(text: string, expectedRupees: number, alsoAllowed: number[] = []): boolean {
  const allowed = new Set([expectedRupees, ...alsoAllowed]);
  const nums = priceNumbers(text);
  if (!nums.includes(expectedRupees)) return false; // must state the right price
  return nums.every((n) => allowed.has(n)); // must not state any unsanctioned price
}
