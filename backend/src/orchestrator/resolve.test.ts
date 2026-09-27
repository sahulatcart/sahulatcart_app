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
/** id of a single match, ids of an ambiguous one, undefined for none. */
const ids = (r: ReturnType<typeof resolveProduct>) => (Array.isArray(r) ? r.map((c) => c.id) : r?.id);

describe('resolveProduct', () => {
  it('matches exact name (case-insensitive)', () => {
    expect(ids(resolveProduct('t-shirt', catalog))).toBe('1');
  });
  it('matches substring / partial mention', () => {
    expect(ids(resolveProduct('mujhe wo mug chahiye', catalog))).toBe('3');
    expect(ids(resolveProduct('tshirt kitnay ka', catalog))).toBe('1'); // punctuation-insensitive
  });
  it('matches via token overlap', () => {
    expect(ids(resolveProduct('coffee', catalog))).toBe('3');
  });
  it('returns null for no match or empty', () => {
    expect(resolveProduct('laptop', catalog)).toBeNull();
    expect(resolveProduct(null, catalog)).toBeNull();
    expect(resolveProduct('   ', catalog)).toBeNull();
  });

  // Regression: production 06 Jul — "kuch shirts dikhain" got "shirts abhi nahi hain"
  it('matches plurals (English + Roman Urdu)', () => {
    expect(ids(resolveProduct('kuch shirts dikhain', catalog))).toBe('1');
    expect(ids(resolveProduct('shirts', catalog))).toBe('1');
    expect(ids(resolveProduct('tshirts', catalog))).toBe('1');
    expect(ids(resolveProduct('t-shirts', catalog))).toBe('1');
    expect(ids(resolveProduct('shirtein chahiye', catalog))).toBe('1');
    expect(ids(resolveProduct('caps', catalog))).toBe('2');
    expect(ids(resolveProduct('mugs kitne ke hain', catalog))).toBe('3');
  });

  it('singular still matches', () => {
    expect(ids(resolveProduct('shirt hi chahiye', catalog))).toBe('1');
    expect(ids(resolveProduct('cap', catalog))).toBe('2');
  });

  // Audit finding: short-name substring false positives
  it('does not match unrelated products via short-name substrings', () => {
    expect(resolveProduct('capri pants', catalog)).toBeNull();
    expect(resolveProduct('mugga', catalog)).toBeNull();
  });

  // Review #16: the first match used to win, and the catalog had no ORDER BY — so "shirt"
  // could resolve to a different product from one message to the next.
  describe('ambiguity', () => {
    const shirts = [item('1', 'T-Shirt'), item('2', 'Dress Shirt'), item('3', 'Coffee Mug')];

    it('returns every candidate when a mention fits several products', () => {
      expect(ids(resolveProduct('shirt', shirts))).toEqual(['1', '2']);
      expect(ids(resolveProduct('shirts dikhao', shirts))).toEqual(['1', '2']);
    });
    it('still resolves a specific mention', () => {
      expect(ids(resolveProduct('dress shirt', shirts))).toBe('2');
      expect(ids(resolveProduct('tshirt', shirts))).toBe('1');
      expect(ids(resolveProduct('mug', shirts))).toBe('3');
    });
    it('prefers the name that contains the others ("t shirt" over "shirt")', () => {
      expect(ids(resolveProduct('blue t shirt', [item('1', 'Shirt'), item('2', 'T Shirt')]))).toBe('2');
    });
  });
});
