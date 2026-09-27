// Money helpers. Everything is integer paisa (1 PKR = 100 paisa) until the reply/UI edge.

/**
 * Parse a human/Meta price string to paisa: "Rs1,500.00", "PKR 1,500", "99.99" → 150000 / 150000 / 9999.
 * Returns null unless there is a positive amount — a Rs 0 product must never become sellable.
 */
export function parsePaisa(v: string | number | null | undefined): number | null {
  const m = String(v ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  const paisa = m ? Math.round(Number(m[0]) * 100) : 0;
  return paisa > 0 ? paisa : null;
}

/** 150000 → "Rs 1500" (buyer-facing text; whole rupees). */
export const rs = (paisa: number): string => `Rs ${Math.round(paisa / 100)}`;
