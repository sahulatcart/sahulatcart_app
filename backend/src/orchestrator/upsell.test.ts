import { describe, it, expect } from 'vitest';
import { pickUpsell, type UpsellCandidate } from './upsell';

const p = (id: string, name: string, price: number, o: Partial<UpsellCandidate> = {}): UpsellCandidate => ({
  id,
  name,
  price,
  stock: null,
  track_stock: false,
  ...o,
});

describe('pickUpsell', () => {
  it('picks the cheapest product not in the order', () => {
    const pick = pickUpsell([p('a', 'T-Shirt', 250000), p('b', 'Cap', 100000), p('c', 'Mug', 80000)], new Set(['a']));
    expect(pick?.id).toBe('c'); // Mug Rs 800 is cheapest
  });

  it('never suggests something the customer just bought', () => {
    const pick = pickUpsell([p('a', 'T-Shirt', 250000), p('c', 'Mug', 80000)], new Set(['c']));
    expect(pick?.id).toBe('a');
  });

  it('skips out-of-stock tracked products', () => {
    const pick = pickUpsell(
      [p('b', 'Cap', 100000, { track_stock: true, stock: 0 }), p('a', 'T-Shirt', 250000)],
      new Set()
    );
    expect(pick?.id).toBe('a');
  });

  it('allows untracked stock (stock null) products', () => {
    const pick = pickUpsell([p('c', 'Mug', 80000, { track_stock: true, stock: null })], new Set());
    expect(pick?.id).toBe('c');
  });

  it('returns null when everything was ordered or unavailable', () => {
    expect(pickUpsell([p('a', 'T-Shirt', 250000)], new Set(['a']))).toBeNull();
    expect(pickUpsell([], new Set())).toBeNull();
    expect(pickUpsell([p('x', 'Free thing', 0)], new Set())).toBeNull(); // zero-priced never suggested
  });
});
