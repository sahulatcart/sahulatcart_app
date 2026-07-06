// Shopify product-export CSV → Sahulatkaar products. Pure mapping, no I/O.
// Shopify exports one row per variant; image-only rows have empty variant fields.
// Rows are grouped by Handle. Headers arrive lowercased from parseCsv.

export interface ShopifyProduct {
  name: string;
  description: string | null;
  price: number; // paisa — cheapest variant
  sku: string | null;
  stock: number | null; // sum of variant quantities (null when Shopify doesn't track)
  images: string[]; // remote URLs, deduped, capped
  attributes: Record<string, string[]>; // e.g. { Size: ['S','M'], Color: ['Red'] }
}

const MAX_IMAGES = 5;

/** True when the parsed CSV looks like a Shopify product export. */
export function isShopifyCsv(rows: Record<string, string>[]): boolean {
  const first = rows[0];
  if (!first) return false;
  return 'handle' in first && 'title' in first && 'variant price' in first;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function mapShopifyRows(rows: Record<string, string>[]): ShopifyProduct[] {
  const byHandle = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const h = (r.handle ?? '').trim();
    if (!h) continue;
    if (!byHandle.has(h)) byHandle.set(h, []);
    byHandle.get(h)!.push(r);
  }

  const out: ShopifyProduct[] = [];
  for (const group of byHandle.values()) {
    const name = group.map((r) => r.title).find((t) => t && t.trim())?.trim();
    if (!name) continue;

    const bodyRaw = group.map((r) => r['body (html)']).find((b) => b && b.trim()) ?? '';
    const description = bodyRaw ? stripHtml(bodyRaw) || null : null;

    let price: number | null = null;
    let stock: number | null = null;
    let sku: string | null = null;
    const images: string[] = [];
    const attributes: Record<string, Set<string>> = {};

    for (const r of group) {
      const p = Number(r['variant price']);
      if (r['variant price'] && Number.isFinite(p) && p > 0) {
        const paisa = Math.round(p * 100);
        if (price == null || paisa < price) price = paisa;
      }
      const q = Number(r['variant inventory qty']);
      if (r['variant inventory qty'] && Number.isFinite(q)) stock = (stock ?? 0) + Math.max(0, Math.round(q));
      if (!sku && r['variant sku']?.trim()) sku = r['variant sku'].trim();
      const img = r['image src']?.trim();
      if (img && /^https?:\/\//i.test(img) && !images.includes(img) && images.length < MAX_IMAGES) images.push(img);
      for (const n of [1, 2, 3]) {
        const optName = r[`option${n} name`]?.trim();
        const optVal = r[`option${n} value`]?.trim();
        if (optName && optVal && optName.toLowerCase() !== 'title' && optVal.toLowerCase() !== 'default title') {
          if (!attributes[optName]) attributes[optName] = new Set();
          attributes[optName].add(optVal);
        }
      }
    }

    if (price == null) continue; // unpriced products cannot be sold by the bot

    out.push({
      name,
      description,
      price,
      sku,
      stock,
      images,
      attributes: Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, [...v]])),
    });
  }
  return out;
}
