/** Display helpers shared by the merchant dashboard and the console. */

/** WhatsApp ids are digits only ("923004561230"); people read "+92 300 4561230". */
export function phone(p: string | null | undefined): string {
  const d = String(p ?? '').replace(/\D/g, '');
  if (!d) return '—';
  if (d.startsWith('92') && d.length === 12) return `+92 ${d.slice(2, 5)} ${d.slice(5)}`;
  return `+${d}`;
}

/** "4 min ago", "3 h ago", "2 days ago"; older than a week, the date. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) { const d = Math.floor(s / 86_400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return day(iso);
}

/** A date with no clock time ("08 Nov"), in Pakistan time: billing periods are days, not minutes. */
export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short' });
}
