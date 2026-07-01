import { describe, it, expect } from 'vitest';
import type { NegotiationDefaults } from '@app/shared';
import { computeFloor, decide } from './engine';
import type { NegotiationHistory, NegotiationInput, ProductPricing } from './types';

// helpers — money in paisa; rs() for readability
const rs = (rupees: number): number => rupees * 100;

const baseDefaults = (o: Partial<NegotiationDefaults> = {}): NegotiationDefaults => ({
  maxDiscountPct: 20,
  concessionSteps: [0.4, 0.7, 0.9, 1.0],
  roundsMax: 3,
  autoAcceptAtFloor: true,
  ...o,
});

const product = (o: Partial<ProductPricing> = {}): ProductPricing => ({
  id: 'p1',
  price: rs(2500),
  cost: null,
  currency: 'PKR',
  negotiable: true,
  maxDiscountPct: 20,
  minPrice: null,
  ...o,
});

const history = (rounds: number, o: Partial<NegotiationHistory> = {}): NegotiationHistory => ({
  rounds,
  lastBotOffer: null,
  lastCustomerOffer: null,
  finalOffered: false,
  status: 'ongoing',
  ...o,
});

const input = (o: Partial<NegotiationInput>): NegotiationInput => ({
  product: product(),
  defaults: baseDefaults(),
  quantity: 1,
  history: history(0),
  customerOffer: null,
  ...o,
});

// ── §10.1 single-product sequences ──────────────────────────────────────────
describe('single-product sequences (§10.1)', () => {
  it('#1 vague "kam karo" opens the curve → COUNTER 2,300', () => {
    const d = decide(input({ customerOffer: null, intent: 'wants_discount', history: history(0) }));
    expect(d.action).toBe('COUNTER');
    expect(d.price).toBe(rs(2300));
  });

  it('#2 offer at/above current counter → ACCEPT 2,300', () => {
    const d = decide(input({ customerOffer: rs(2300), history: history(0) }));
    expect(d.action).toBe('ACCEPT');
    expect(d.price).toBe(rs(2300));
  });

  it('#3 offer == floor → ACCEPT 2,000 (autoAccept)', () => {
    const d = decide(input({ customerOffer: rs(2000), history: history(0) }));
    expect(d.action).toBe('ACCEPT');
    expect(d.price).toBe(rs(2000));
  });

  it('#4 below-floor offers walk down the curve: 2,300 → 2,150 → 2,050', () => {
    expect(decide(input({ customerOffer: rs(1900), history: history(0) })).price).toBe(rs(2300));
    expect(decide(input({ customerOffer: rs(1950), history: history(1) })).price).toBe(rs(2150));
    expect(decide(input({ customerOffer: rs(1980), history: history(2) })).price).toBe(rs(2050));
  });

  it('#5 repeated lowball → final floor offer then REJECT/handoff', () => {
    const r3 = decide(input({ customerOffer: rs(1900), history: history(3, { finalOffered: false }) }));
    expect(r3.action).toBe('COUNTER');
    expect(r3.price).toBe(rs(2000)); // = floor
    expect(r3.final).toBe(true);

    const r4 = decide(input({ customerOffer: rs(1900), history: history(4, { finalOffered: true }) }));
    expect(r4.action).toBe('REJECT');
    expect(r4.reason).toBe('stalemate');
  });

  it('#6 offer above list → ACCEPT at list (never overcharge)', () => {
    const d = decide(input({ customerOffer: rs(2600), history: history(0) }));
    expect(d.action).toBe('ACCEPT');
    expect(d.price).toBe(rs(2500));
  });

  it('#7 non-negotiable, below list → HOLD list', () => {
    const d = decide(input({ product: product({ negotiable: false }), customerOffer: rs(2200) }));
    expect(d.action).toBe('HOLD');
    expect(d.price).toBe(rs(2500));
    expect(d.reason).toBe('non_negotiable');
  });

  it('#8 non-negotiable, at list → ACCEPT', () => {
    const d = decide(input({ product: product({ negotiable: false }), customerOffer: rs(2500) }));
    expect(d.action).toBe('ACCEPT');
    expect(d.price).toBe(rs(2500));
  });

  it('#9 absurd offer → HOLD current counter, round not advanced', () => {
    const d = decide(input({ customerOffer: rs(1), history: history(0) }));
    expect(d.action).toBe('HOLD');
    expect(d.price).toBe(rs(2300));
    expect(d.reason).toBe('absurd_offer');
  });

  it('#10 first-turn offer already ≥ floor → ACCEPT 2,499', () => {
    const d = decide(input({ customerOffer: rs(2499), history: history(0) }));
    expect(d.action).toBe('ACCEPT');
    expect(d.price).toBe(rs(2499));
  });

  it('#11 re-open after agreement → HOLD agreed price, locked', () => {
    const d = decide(
      input({ customerOffer: null, history: history(2, { status: 'agreed', lastBotOffer: rs(2000) }) })
    );
    expect(d.action).toBe('HOLD');
    expect(d.price).toBe(rs(2000));
    expect(d.reason).toBe('agreed_locked');
  });
});

// ── §10.2 floor / margin / bulk edge cases ──────────────────────────────────
describe('floor / margin / bulk (§10.2)', () => {
  it('#12 min_price wins over pct', () => {
    const f = computeFloor(product({ price: rs(5000), maxDiscountPct: 40, minPrice: rs(3500) }), baseDefaults(), 1);
    expect(f).toBe(rs(3500));
  });

  it('#13 margin guard raises floor', () => {
    const f = computeFloor(
      product({ price: rs(5000), cost: rs(3500), maxDiscountPct: 40 }),
      baseDefaults({ minMarginPct: 15 }),
      1
    );
    expect(f).toBe(rs(4025));
  });

  it('#14 margin guard inert without cost', () => {
    const f = computeFloor(
      product({ price: rs(5000), cost: null, maxDiscountPct: 40 }),
      baseDefaults({ minMarginPct: 15 }),
      1
    );
    expect(f).toBe(rs(3000));
  });

  it('#15 per-product max_discount beats merchant default', () => {
    const f = computeFloor(product({ price: rs(1000), maxDiscountPct: 5 }), baseDefaults({ maxDiscountPct: 30 }), 1);
    expect(f).toBe(rs(950));
  });

  it('#16 no discount allowed → floor = list, bot HOLDs list', () => {
    const p = product({ price: rs(1000), maxDiscountPct: null });
    const defs = baseDefaults({ maxDiscountPct: 0 });
    expect(computeFloor(p, defs, 1)).toBe(rs(1000));
    const d = decide(input({ product: p, defaults: defs, customerOffer: rs(900), history: history(0) }));
    expect(d.action).toBe('HOLD');
    expect(d.price).toBe(rs(1000));
    expect(d.reason).toBe('no_discount_room');
  });

  it('#17 bulk tier lowers floor', () => {
    const p = product({
      price: rs(3000),
      maxDiscountPct: 5,
      bulkTiers: [
        { minQty: 10, extraDiscountPct: 5 },
        { minQty: 50, extraDiscountPct: 10 },
      ],
    });
    expect(computeFloor(p, baseDefaults(), 60)).toBe(rs(2550));
  });

  it('#18 bulk still floored by min_price', () => {
    const p = product({
      price: rs(3000),
      minPrice: rs(2700),
      maxDiscountPct: 5,
      bulkTiers: [{ minQty: 50, extraDiscountPct: 10 }],
    });
    expect(computeFloor(p, baseDefaults(), 60)).toBe(rs(2700));
  });

  it('#19 rounding never breaks the floor', () => {
    const f = computeFloor(product({ price: 99900, maxDiscountPct: 33, minPrice: null }), baseDefaults(), 1);
    expect(f).toBe(66900); // Rs.669
  });
});

// ── invariant: every emitted price stays within [floor, listPrice] ──────────
describe('invariants', () => {
  it('never returns a price below floor or above list across a fuzz of offers', () => {
    const p = product({ price: rs(2500), maxDiscountPct: 20 });
    const defs = baseDefaults();
    const floor = computeFloor(p, defs, 1);
    for (let rounds = 0; rounds <= 5; rounds++) {
      for (let offer = 0; offer <= 3000; offer += 37) {
        const d = decide(input({ product: p, defaults: defs, customerOffer: rs(offer), history: history(rounds) }));
        if (d.price !== undefined) {
          expect(d.price).toBeGreaterThanOrEqual(floor);
          expect(d.price).toBeLessThanOrEqual(p.price);
        }
      }
    }
  });

  it('ignores any model-suggested price — a jailbreak offer of Rs.1 never lowers the floor', () => {
    const d = decide(input({ customerOffer: rs(1), history: history(0) }));
    expect(d.price ?? Infinity).toBeGreaterThanOrEqual(rs(2000));
  });
});
