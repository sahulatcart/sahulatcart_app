import { describe, it, expect } from 'vitest';
import { parsePaisa } from './money';

describe('parsePaisa', () => {
  it('parses Meta-formatted prices without inflating them 100x', () => {
    expect(parsePaisa('Rs1,500.00')).toBe(150000);
    expect(parsePaisa('PKR 1,500')).toBe(150000);
    expect(parsePaisa('1500.00 PKR')).toBe(150000);
    expect(parsePaisa('Rs. 2,499.50')).toBe(249950);
  });
  it('parses plain decimals exactly', () => {
    expect(parsePaisa('99.99')).toBe(9999);
    expect(parsePaisa('0.29')).toBe(29);
    expect(parsePaisa(2500)).toBe(250000);
  });
  it('returns null for missing, zero or unreadable prices', () => {
    for (const v of ['', '0', '0.00', 'Rs 0', 'free', null, undefined]) expect(parsePaisa(v)).toBeNull();
  });
});
