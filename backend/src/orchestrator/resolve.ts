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

export function resolveProduct(query: string | null, catalog: CatalogItem[]): CatalogItem | null {
  if (!query) return null;
  const q = norm(query);
  if (!q) return null;

  // 1. exact name
  const exact = catalog.find((c) => norm(c.name) === q);
  if (exact) return exact;

  // 2. substring either direction — the shorter side must be a real word (≥4 chars),
  //    or "capri pants" would match "Cap".
  const sub = catalog.find((c) => {
    const n = norm(c.name);
    if (Math.min(n.length, q.length) < 4) return false;
    return n.includes(q) || q.includes(n);
  });
  if (sub) return sub;

  // 3. compact (spaces removed, stemmed) — "tshirts"/"t-shirt" vs "T Shirt"
  const compactOf = (s: string) => s.split(' ').map(stem).join('');
  const qc = compactOf(q);
  const compact = catalog.find((c) => {
    const nc = compactOf(norm(c.name));
    return nc.length >= 4 && (qc.includes(nc) || nc.includes(qc));
  });
  if (compact) return compact;

  // 4. stemmed token overlap (best score wins) — "kuch shirts dikhain" → {shirt} ∩ {t, shirt}
  const qt = new Set(q.split(' ').map(stem));
  let best: CatalogItem | null = null;
  let bestScore = 0;
  for (const c of catalog) {
    const score = norm(c.name)
      .split(' ')
      .map(stem)
      .filter((t) => qt.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}
