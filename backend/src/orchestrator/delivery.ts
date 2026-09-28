// Delivery-zone matching. Plain word matching in code — the customer's text is never turned into a
// SQL pattern (a "%" in an ilike pattern used to match every zone).
export interface Zone {
  area_name: string;
  charge: number; // paisa
  is_serviceable: boolean;
}

const words = (s: string): string => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * The merchant's zone for the area a customer typed: a zone named inside it ("DHA Phase 5, Lahore"
 * → "DHA Phase 5") or one containing it ("Gulberg" → "Gulberg III"), whole words only. The longest
 * (most specific) zone name wins. Null when nothing matches.
 */
export function matchZone<Z extends Zone>(area: string, zones: Z[]): Z | null {
  const a = words(area);
  if (a.trim().length < 3) return null;
  let best: Z | null = null;
  for (const z of zones) {
    const n = words(z.area_name);
    if (n.trim().length >= 3 && (a.includes(n) || n.includes(a)) && (!best || n.length > words(best.area_name).length)) best = z;
  }
  return best;
}
