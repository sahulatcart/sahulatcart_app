// Product-image URL resolution. products.images[] holds either a storage key in the
// PUBLIC product-images bucket (portal uploads) or a full http(s) URL (Shopify import).
export function productImageUrl(supabaseUrl: string, ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/product-images/${ref}`;
}
