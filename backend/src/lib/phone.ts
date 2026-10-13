/**
 * Phone numbers are digits only everywhere they are stored or compared (SRS Part 0.3):
 * `923001234567`, never `+92 300…`. `customers.wa_id` already arrives that way from Meta.
 */
export const digitsOnly = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

export const samePhone = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = digitsOnly(a);
  const y = digitsOnly(b);
  return x.length > 0 && x === y;
};
