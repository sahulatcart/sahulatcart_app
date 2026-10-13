// API client — same-origin (/api proxied to backend). Auth = Supabase JWT (Bearer).
import { accessToken, getSupabase } from './supabase';

export async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/config')) {
    // A valid login with no shop yet is sent to bootstrap one, not back to /login (that was a loop).
    const j = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
    window.location.href = j?.error?.code === 'no_membership' ? '/auth/confirmed' : '/login';
  }
  return res;
}

// ── Self-service signup and password reset (P1). Auth lives in Supabase; the backend only
// gates signup and creates the shop. The portal's own origin is the redirect target.

export interface SignupData {
  shopName: string;
  ownerName: string;
  phone: string;
  attestations: { noProhibitedGoods: true; optInOnly: true };
}

/** Is this email allowed to create a shop right now (allow-list until signup opens)? */
export async function checkSignup(email: string): Promise<boolean> {
  const r = await fetch('/api/v1/signup/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const j = (await r.json().catch(() => null)) as { allowed?: boolean } | null;
  return j?.allowed === true;
}

/** Create the auth user; Supabase emails a confirmation link that lands on /auth/confirmed. */
export async function signUp(email: string, password: string, data: SignupData): Promise<{ ok: true } | { ok: false; exists: boolean; message: string }> {
  const sb = await getSupabase();
  const { data: res, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/confirmed`, data } });
  if (error) {
    const exists = (error as { code?: string }).code === 'user_already_exists' || /already/i.test(error.message);
    return { ok: false, exists, message: error.message };
  }
  // With "Confirm email" on, a repeat signup is answered with a user that has no identities.
  if (res.user && Array.isArray(res.user.identities) && res.user.identities.length === 0) return { ok: false, exists: true, message: 'already registered' };
  return { ok: true };
}

/** Turn the confirmed login into a shop (idempotent); the response carries { merchantId, role }. */
export function bootstrap(): Promise<Response> {
  return api('/api/v1/signup/bootstrap', { method: 'POST', body: '{}' });
}

export async function sendPasswordReset(email: string): Promise<void> {
  const sb = await getSupabase();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset` });
}

export async function updatePassword(password: string): Promise<string | null> {
  const sb = await getSupabase();
  const { error } = await sb.auth.updateUser({ password });
  return error ? error.message : null;
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
