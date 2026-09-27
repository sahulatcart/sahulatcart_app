import { describe, it, expect } from 'vitest';
import { isTrustedImageUrl, productImageUrl } from './images';

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

describe('isTrustedImageUrl', () => {
  const BASE = 'https://xyz.supabase.co';

  it('allows our own storage and the Shopify CDN', () => {
    expect(isTrustedImageUrl(productImageUrl(BASE, 'm1/p1/a.jpg')!, BASE)).toBe(true);
    expect(isTrustedImageUrl('https://cdn.shopify.com/s/files/tee.jpg', BASE)).toBe(true);
  });
  it('rejects anything else, including look-alike and internal hosts', () => {
    for (const url of [
      'http://appbackend.railway.internal/api/v1/config',
      'http://169.254.169.254/latest/meta-data',
      'https://cdn.shopify.com.evil.example/x.jpg',
      'http://cdn.shopify.com/x.jpg',
      'https://xyz.supabase.co.evil.example/x.jpg',
      'not a url',
    ]) expect(isTrustedImageUrl(url, BASE)).toBe(false);
  });
});
