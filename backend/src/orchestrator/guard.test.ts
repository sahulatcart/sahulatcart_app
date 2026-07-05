import { describe, it, expect } from 'vitest';
import { priceGuardOk, priceNumbers } from './guard';

describe('priceGuardOk (outbound price-match, CD-38)', () => {
  it('passes when the exact price is stated and no other price', () => {
    expect(priceGuardOk('T-Shirt Rs 2500 ka hai.', 2500)).toBe(true);
    expect(priceGuardOk('theek hai, Rs 2,500 final', 2500)).toBe(true); // comma tolerated
  });
  it('fails when a different price appears (hallucinated figure)', () => {
    expect(priceGuardOk('Rs 250 me de deta hoon', 2500)).toBe(false);
    expect(priceGuardOk('Rs 2500 ya 2400 chalega', 2500)).toBe(false);
  });
  it('fails when the expected price is missing', () => {
    expect(priceGuardOk('theek hai bhai', 2500)).toBe(false);
  });
  it('ignores small non-price numbers', () => {
    expect(priceNumbers('2 T-shirt Rs 2500')).toEqual([2500]);
  });

  // multi-unit quotes: the engine-derived line total is sanctioned, nothing else
  it('allows the sanctioned line total alongside the unit price', () => {
    expect(priceGuardOk('3 T-shirts: Rs 2500 per piece, total Rs 7500.', 2500, [7500])).toBe(true);
  });
  it('still requires the unit price even when the total is present', () => {
    expect(priceGuardOk('3 T-shirts total Rs 7500.', 2500, [7500])).toBe(false);
  });
  it('rejects a third, unsanctioned number', () => {
    expect(priceGuardOk('Rs 2500 each, total Rs 7500, ya phir 7000 de dena', 2500, [7500])).toBe(false);
  });
  it('without an allowed total, a second number still fails (unchanged behavior)', () => {
    expect(priceGuardOk('Rs 2500 each, total Rs 7500', 2500)).toBe(false);
  });
});
