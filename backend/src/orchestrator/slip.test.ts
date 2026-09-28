import { describe, it, expect } from 'vitest';
import { isPdfSafe, type SlipData } from './slip';

const slip = (o: Partial<SlipData> = {}, name = 'Ahmed Khan'): SlipData => ({
  orderNumber: 'SK-1001', placedAt: null, businessName: 'Shop', items: [{ name: 'T-Shirt', qty: 1, lineTotal: 250000 }],
  subtotal: 250000, discount: 0, deliveryCharge: 0, total: 250000, paymentLabel: 'Cash on Delivery',
  delivery: { name, address: 'House 12, Street 4', area: 'DHA', city: 'Lahore', phone: '923001234567' }, ...o,
});

describe('isPdfSafe', () => {
  it('accepts Latin text, including accents and missing fields', () => {
    expect(isPdfSafe(slip())).toBe(true);
    expect(isPdfSafe(slip({}, 'José Müller'))).toBe(true);
    expect(isPdfSafe(slip({ delivery: { name: null, address: null, area: null, city: null, phone: null } }))).toBe(true);
  });
  it('rejects Urdu script or emoji anywhere the PDF would print it', () => {
    expect(isPdfSafe(slip({}, 'احمد خان'))).toBe(false);
    expect(isPdfSafe(slip({ items: [{ name: 'کرتا', qty: 1, lineTotal: 100 }] }))).toBe(false);
    expect(isPdfSafe(slip({ businessName: 'Shop 🛍️' }))).toBe(false);
  });
});
