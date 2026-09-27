// Product-image URL resolution. products.images[] holds either a storage key in the
// PUBLIC product-images bucket (portal uploads) or a full http(s) URL (Shopify import).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function productImageUrl(supabaseUrl: string, ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/product-images/${ref}`;
}

/**
 * True only for our own Supabase storage or Shopify's CDN. The server must never fetch an
 * arbitrary merchant-supplied URL — that would let an imported image reach internal hosts (SSRF).
 */
export function isTrustedImageUrl(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === new URL(supabaseUrl).origin || u.origin === 'https://cdn.shopify.com';
  } catch {
    return false;
  }
}
