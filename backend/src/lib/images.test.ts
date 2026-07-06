import { describe, it, expect } from 'vitest';
import { productImageUrl } from './images';

describe('productImageUrl', () => {
  const BASE = 'https://xyz.supabase.co';

  it('builds a public bucket URL from a storage key', () => {
    expect(productImageUrl(BASE, 'm1/p1/a.jpg')).toBe('https://xyz.supabase.co/storage/v1/object/public/product-images/m1/p1/a.jpg');
  });
  it('passes through external URLs (Shopify imports)', () => {
    expect(productImageUrl(BASE, 'https://cdn.shopify.com/tee.jpg')).toBe('https://cdn.shopify.com/tee.jpg');
  });
  it('handles a trailing slash on the base URL', () => {
    expect(productImageUrl(BASE + '/', 'k.png')).toBe('https://xyz.supabase.co/storage/v1/object/public/product-images/k.png');
  });
  it('returns null for empty refs', () => {
    expect(productImageUrl(BASE, null)).toBeNull();
    expect(productImageUrl(BASE, '')).toBeNull();
    expect(productImageUrl(BASE, undefined)).toBeNull();
  });
});
