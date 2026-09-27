// Deterministic product resolution — match a customer's free-text mention to a catalog
// item. NOT the LLM's job to pick the product id (docs/spec/05); the LLM extracts the
// text, this resolves it.
export interface CatalogItem {
  id: string;
  name: string;
  price: number; // paisa
  cost: number | null;
  currency: 'PKR';
  negotiable: boolean;
  maxDiscountPct: number | null;
  minPrice: number | null;
  stock: number | null;
  trackStock: boolean;
  description?: string | null;
  attributes?: Record<string, unknown> | null;
  images?: string[]; // storage keys or full URLs
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Strip common plural suffixes (English + Roman Urdu): shirts→shirt, shirtein→shirt, boxes→box. */
const stem = (t: string): string => {
  if (t.length > 4 && t.endsWith('ein')) return t.slice(0, -3);
  if (t.length > 4 && (t.endsWith('ain') || t.endsWith('aan'))) return t.slice(0, -3);
  if (t.length > 3 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
};

/**
 * One match wins. Several are ambiguous — unless one name contains all the others, which makes
 * it the more specific mention ("t shirt" beats "shirt"). Ambiguity is returned, never guessed.
 */
function pick(matches: CatalogItem[]): CatalogItem | CatalogItem[] | null {
  if (matches.length <= 1) return matches[0] ?? null;
  const longest = matches.reduce((a, b) => (norm(b.name).length > norm(a.name).length ? b : a));
  return matches.every((m) => norm(longest.name).includes(norm(m.name))) ? longest : matches;
}

/** The product the customer means, several candidates when it is ambiguous, or null. */
export function resolveProduct(query: string | null, catalog: CatalogItem[]): CatalogItem | CatalogItem[] | null {
  if (!query) return null;
  const q = norm(query);
  if (!q) return null;

  // 1. exact name
  const exact = catalog.find((c) => norm(c.name) === q);
  if (exact) return exact;

  // 2. substring either direction — the shorter side must be a real word (≥4 chars),
  //    or "capri pants" would match "Cap".
  const sub = pick(catalog.filter((c) => {
    const n = norm(c.name);
    return Math.min(n.length, q.length) >= 4 && (n.includes(q) || q.includes(n));
  }));
  if (sub) return sub;

  // 3. compact (spaces removed, stemmed) — "tshirts"/"t-shirt" vs "T Shirt"
  const compactOf = (s: string) => s.split(' ').map(stem).join('');
  const qc = compactOf(q);
  const compact = pick(catalog.filter((c) => {
    const nc = compactOf(norm(c.name));
    return nc.length >= 4 && (qc.includes(nc) || nc.includes(qc));
  }));
  if (compact) return compact;

  // 4. stemmed token overlap (best score wins; a tie is ambiguous) — "kuch shirts dikhain"
  const qt = new Set(q.split(' ').map(stem));
  const scored = catalog.map((c) => ({ c, score: norm(c.name).split(' ').map(stem).filter((t) => qt.has(t)).length }));
  const best = Math.max(0, ...scored.map((x) => x.score));
  return best > 0 ? pick(scored.filter((x) => x.score === best).map((x) => x.c)) : null;
}
