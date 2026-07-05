// Post-order upsell — deterministic pick, no LLM involved in the choice.
export interface UpsellCandidate {
  id: string;
  name: string;
  price: number; // paisa
  stock: number | null;
  track_stock: boolean;
}

/**
 * Pick the add-on to suggest after a confirmed order: the CHEAPEST other in-stock
 * active product. Cheap add-ons convert best and never feel pushy. Returns null
 * when there is nothing sensible to suggest.
 */
export function pickUpsell(products: UpsellCandidate[], excludeIds: Set<string>): UpsellCandidate | null {
  const eligible = products
    .filter((p) => !excludeIds.has(p.id))
    .filter((p) => p.price > 0)
    .filter((p) => !(p.track_stock && p.stock != null && p.stock <= 0));
  if (!eligible.length) return null;
  return eligible.reduce((best, p) => (p.price < best.price ? p : best));
}
