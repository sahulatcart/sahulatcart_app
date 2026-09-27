// API client — same-origin (/api proxied to backend). Auth = Supabase JWT (Bearer).
import { accessToken, getSupabase } from './supabase';

export async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/config')) {
    window.location.href = '/login';
  }
  return res;
}

/** The server's error message from a failed response, for a toast. */
export async function apiError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Request failed (${r.status})`;
}

/** Parsed JSON of a successful response. Rejects on an error status, so an error body is never rendered as data. */
export async function apiJson<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const r = await api(path, opts);
  if (!r.ok) throw new Error(await apiError(r));
  return r.json() as Promise<T>;
}

export async function signIn(email: string, password: string): Promise<boolean> {
  const { error } = await (await getSupabase()).auth.signInWithPassword({ email, password });
  return !error;
}

export async function signOut(): Promise<void> {
  await (await getSupabase()).auth.signOut();
}

export async function hasSession(): Promise<boolean> {
  return !!(await accessToken());
}

export const rs = (paisa: number): string => `Rs ${Math.round((paisa ?? 0) / 100).toLocaleString('en-PK')}`;

/** Format an ISO timestamp in Pakistan time, e.g. "06 Jul, 5:45 pm". */
export function dt(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
