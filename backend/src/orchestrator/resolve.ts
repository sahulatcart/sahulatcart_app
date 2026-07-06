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

export function resolveProduct(query: string | null, catalog: CatalogItem[]): CatalogItem | null {
  if (!query) return null;
  const q = norm(query);
  if (!q) return null;

  // 1. exact name
  const exact = catalog.find((c) => norm(c.name) === q);
  if (exact) return exact;

  // 2. substring either direction
  const sub = catalog.find((c) => {
    const n = norm(c.name);
    return n.includes(q) || q.includes(n);
  });
  if (sub) return sub;

  // 3. compact (spaces removed) — handles "tshirt" vs "t shirt" vs "t-shirt"
  const qc = q.replace(/\s+/g, '');
  const compact = catalog.find((c) => {
    const nc = norm(c.name).replace(/\s+/g, '');
    return nc.length >= 4 && (qc.includes(nc) || nc.includes(qc));
  });
  if (compact) return compact;

  // 4. token overlap (best score wins)
  const qt = new Set(q.split(' '));
  let best: CatalogItem | null = null;
  let bestScore = 0;
  for (const c of catalog) {
    const score = norm(c.name)
      .split(' ')
      .filter((t) => qt.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}
