// Validation for merchant-editable fields (admin API, CSV import). Money is integer paisa.
type Rules = Record<string, (v: unknown) => boolean>;
const paisa = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0;
const optional = (ok: (v: unknown) => boolean) => (v: unknown): boolean => v == null || ok(v);
const bool = (v: unknown): boolean => typeof v === 'boolean';
const pct = (v: unknown): boolean => typeof v === 'number' && v >= 0 && v <= 100;

/** Returns a checker: the first field of `b` that is present but breaks its rule, or null. */
const firstInvalid = (rules: Rules) => (b: Record<string, unknown>): string | null =>
  Object.keys(rules).find((k) => k in b && !rules[k]!(b[k])) ?? null;

export const invalidProductField = firstInvalid({
  name: (v) => typeof v === 'string' && v.trim().length > 0,
  price: paisa, // never 0 — the bot would quote "Rs 0"
  cost: optional(paisa),
  min_price: optional(paisa),
  max_discount_pct: optional(pct),
  stock: optional((v) => Number.isInteger(v) && (v as number) >= 0),
  negotiable: bool,
  is_active: bool,
  track_stock: bool,
});

/** merchants.negotiation_defaults — a typo like maxDiscountPct 150 would put every floor at Rs 0. */
export const invalidNegotiationField = firstInvalid({
  maxDiscountPct: pct,
  minMarginPct: optional((v) => typeof v === 'number' && v >= 0),
  roundsMax: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10,
  concessionSteps: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && x > 0 && x <= 1),
  autoAcceptAtFloor: bool,
  openingStance: optional((v) => v === 'list_price' || v === 'small_goodwill'),
  stalemateAction: optional((v) => v === 'handoff' || v === 'hold_and_close'),
  bulkTiers: optional((v) => Array.isArray(v) && v.every((t: { minQty?: unknown; extraDiscountPct?: unknown }) =>
    Number.isInteger(t?.minQty) && (t.minQty as number) >= 2 && pct(t?.extraDiscountPct))),
});

/** merchants.settings — only the money/switch fields; free text (kb, persona) is not constrained. */
export const invalidSettingsField = firstInvalid({
  defaultDeliveryCharge: (v) => Number.isInteger(v) && (v as number) >= 0,
  botEnabled: bool,
  upsellEnabled: bool,
});
