/**
 * Phone numbers are digits only everywhere they are stored or compared (SRS Part 0.3):
 * `923001234567`, never `+92 300…`. `customers.wa_id` already arrives that way from Meta,
 * while people type +92 300 1234567 or 0300-1234567.
 */

/** Just the digits, nothing else (an empty string when there are none). */
export const digitsOnly = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

/**
 * Digits only, with the two local spellings folded in: a leading 00 dropped and a local
 * 0300… turned into 92300…. Null when nothing is left or the input is not a string.
 */
export function phoneDigits(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = digitsOnly(input);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = `92${d.slice(1)}`;
  return d || null;
}

/** A Pakistani mobile number in digits-only form: 92 + 3 + nine more digits. */
export function isPakistaniMobile(digits: string | null): digits is string {
  return !!digits && /^923\d{9}$/.test(digits);
}

/** True when two numbers in any format are the same number. */
export function samePhone(a: unknown, b: unknown): boolean {
  const x = phoneDigits(a);
  return !!x && x === phoneDigits(b);
}
