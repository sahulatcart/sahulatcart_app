import { describe, it, expect } from 'vitest';
import { invalidNegotiationField, invalidProductField, invalidSettingsField } from './validation';

describe('invalidProductField', () => {
  it('accepts a valid product and ignores fields that are absent', () => {
    expect(invalidProductField({ name: 'Mug', price: 80000, stock: 3, min_price: null, max_discount_pct: 20, negotiable: true })).toBeNull();
    expect(invalidProductField({ stock: 0 })).toBeNull();
  });
  it('rejects a zero, negative or fractional price', () => {
    for (const price of [0, -100, 99.5, '2500', null]) expect(invalidProductField({ price })).toBe('price');
  });
  it('requires name and price when they are forced present (create)', () => {
    expect(invalidProductField({ name: undefined, price: undefined, stock: 2 })).toBe('name');
    expect(invalidProductField({ name: 'Mug', price: undefined })).toBe('price');
  });
  it('rejects out-of-range floors and stock', () => {
    expect(invalidProductField({ max_discount_pct: 150 })).toBe('max_discount_pct');
    expect(invalidProductField({ max_discount_pct: Number.NaN })).toBe('max_discount_pct');
    expect(invalidProductField({ min_price: 0 })).toBe('min_price');
    expect(invalidProductField({ stock: -1 })).toBe('stock');
    expect(invalidProductField({ stock: 2.5 })).toBe('stock');
  });
});

describe('invalidNegotiationField', () => {
  it('accepts the portal presets', () => {
    expect(invalidNegotiationField({ maxDiscountPct: 15, roundsMax: 4, concessionSteps: [0.25, 0.5, 0.75, 1.0] })).toBeNull();
  });
  it('rejects values that would break the price floor or the haggle loop', () => {
    expect(invalidNegotiationField({ maxDiscountPct: 150 })).toBe('maxDiscountPct');
    expect(invalidNegotiationField({ maxDiscountPct: '20' })).toBe('maxDiscountPct');
    expect(invalidNegotiationField({ roundsMax: 0 })).toBe('roundsMax');
    expect(invalidNegotiationField({ concessionSteps: [0.5, 2] })).toBe('concessionSteps');
    expect(invalidNegotiationField({ concessionSteps: [] })).toBe('concessionSteps');
  });
  it('checks stalemate action and bulk tiers', () => {
    expect(invalidNegotiationField({ stalemateAction: 'hold_and_close', bulkTiers: [{ minQty: 10, extraDiscountPct: 5 }] })).toBeNull();
    expect(invalidNegotiationField({ bulkTiers: [] })).toBeNull(); // clears them
    expect(invalidNegotiationField({ stalemateAction: 'walk_away' })).toBe('stalemateAction');
    expect(invalidNegotiationField({ bulkTiers: [{ minQty: 1, extraDiscountPct: 5 }] })).toBe('bulkTiers');
    expect(invalidNegotiationField({ bulkTiers: [{ minQty: 10, extraDiscountPct: 150 }] })).toBe('bulkTiers');
  });
});

describe('invalidSettingsField', () => {
  it('rejects a negative delivery charge and non-boolean switches', () => {
    expect(invalidSettingsField({ defaultDeliveryCharge: 20000, botEnabled: false })).toBeNull();
    expect(invalidSettingsField({ defaultDeliveryCharge: -100 })).toBe('defaultDeliveryCharge');
    expect(invalidSettingsField({ botEnabled: 'no' })).toBe('botEnabled');
  });
});
