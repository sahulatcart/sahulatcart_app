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

export async function apiJson<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  return (await api(path, opts)).json() as Promise<T>;
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
