import { describe, it, expect } from 'vitest';
import { resolveProduct, type CatalogItem } from './resolve';

const item = (id: string, name: string): CatalogItem => ({
  id,
  name,
  price: 100000,
  cost: null,
  currency: 'PKR',
  negotiable: true,
  maxDiscountPct: null,
  minPrice: null,
  stock: null,
  trackStock: false,
});

const catalog = [item('1', 'T-Shirt'), item('2', 'Cap'), item('3', 'Coffee Mug')];

describe('resolveProduct', () => {
  it('matches exact name (case-insensitive)', () => {
    expect(resolveProduct('t-shirt', catalog)?.id).toBe('1');
  });
  it('matches substring / partial mention', () => {
    expect(resolveProduct('mujhe wo mug chahiye', catalog)?.id).toBe('3');
    expect(resolveProduct('tshirt kitnay ka', catalog)?.id).toBe('1'); // punctuation-insensitive
  });
  it('matches via token overlap', () => {
    expect(resolveProduct('coffee', catalog)?.id).toBe('3');
  });
  it('returns null for no match or empty', () => {
    expect(resolveProduct('laptop', catalog)).toBeNull();
    expect(resolveProduct(null, catalog)).toBeNull();
    expect(resolveProduct('   ', catalog)).toBeNull();
  });
});
