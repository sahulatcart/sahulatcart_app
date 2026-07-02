// Thin API client for the admin portal. Token in localStorage (pilot; Supabase JWT later).
// Same-origin: Next.js rewrites /api/* → BACKEND_URL (see next.config.mjs).
const BASE = '';

export const getToken = (): string | null => (typeof window === 'undefined' ? null : localStorage.getItem('sk_token'));
export const setToken = (t: string): void => localStorage.setItem('sk_token', t);
export const clearToken = (): void => localStorage.removeItem('sk_token');

export async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { 'x-admin-token': token || '', ...((opts.headers as Record<string, string>) || {}) };
  // Only declare JSON content-type when there's actually a body (empty body + JSON type = 400).
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { ...opts, headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    clearToken();
    window.location.href = '/login';
  }
  return res;
}

export async function apiJson<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const r = await api(path, opts);
  return r.json() as Promise<T>;
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch(BASE + '/api/v1/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return false;
  const { token } = (await res.json()) as { token: string };
  setToken(token);
  return true;
}

export const rs = (paisa: number): string => `Rs ${Math.round((paisa ?? 0) / 100).toLocaleString('en-PK')}`;
