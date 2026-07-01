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
});
