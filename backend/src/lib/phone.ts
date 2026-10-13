// Phone numbers are digits only everywhere they are stored or compared (SRS Part 0.3):
// WhatsApp sends wa_id as 923001234567, while people type +92 300 1234567 or 03001234567.

/** Strip everything but digits, and turn a local 0300… into 92300…. Null when nothing is left. */
export function phoneDigits(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
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
