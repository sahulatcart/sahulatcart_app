// merchants.business_hours (P2): { mon: { open: '10:00', close: '22:00' }, fri: { closed: true }, … }.
// Used by the greeting (FR-P2.5) and the WhatsApp business profile (IC-9).

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export type DayHours = { open: string; close: string } | { closed: true };
export type BusinessHours = Partial<Record<Day, DayHours>>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isOpen = (d: unknown): d is { open: string; close: string } =>
  !!d && typeof d === 'object' && TIME.test(String((d as { open?: unknown }).open)) && TIME.test(String((d as { close?: unknown }).close));

/** True when the value is a well-formed hours object (every key a day, every day open/close times or closed). */
export function validBusinessHours(h: unknown): h is BusinessHours {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false;
  return Object.entries(h as Record<string, unknown>).every(([k, d]) =>
    (DAYS as readonly string[]).includes(k) && (isOpen(d) || (!!d && typeof d === 'object' && (d as { closed?: unknown }).closed === true)),
  );
}

/** The weekday in Pakistan for an instant: 'mon' … 'sun'. */
/** ISO instant of 00:00 today in Pakistan time (no DST there, so a fixed +05:00). P5, FR-P5.6. */
export function startOfTodayKarachi(now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${ymd}T00:00:00+05:00`).toISOString();
}

export function dayInKarachi(now: Date = new Date()): Day {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Karachi' }).format(now).toLowerCase();
  return (DAYS.find((d) => d === name) ?? 'mon') as Day;
}

/** "Hum aaj 10:00–22:00 khule hain." for today's hours, or null when today is closed or unset. */
export function todayHoursText(hours: unknown, now: Date = new Date()): string | null {
  if (!validBusinessHours(hours)) return null;
  const d = hours[dayInKarachi(now)];
  return isOpen(d) ? `Hum aaj ${d.open}–${d.close} khule hain.` : null;
}

const LABEL: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** "Mon–Fri 10:00–22:00, Sat 10:00–18:00" — consecutive days with the same times are folded. */
export function formatHours(hours: unknown): string | null {
  if (!validBusinessHours(hours)) return null;
  const runs: { from: Day; to: Day; text: string }[] = [];
  for (const day of DAYS) {
    const d = hours[day];
    if (!isOpen(d)) continue;
    const text = `${d.open}–${d.close}`;
    const last = runs.at(-1);
    if (last && last.text === text && DAYS.indexOf(last.to) === DAYS.indexOf(day) - 1) last.to = day;
    else runs.push({ from: day, to: day, text });
  }
  if (!runs.length) return null;
  return runs.map((r) => `${r.from === r.to ? LABEL[r.from] : `${LABEL[r.from]}–${LABEL[r.to]}`} ${r.text}`).join(', ');
}
