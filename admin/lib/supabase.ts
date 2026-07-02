'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase URL + publishable anon key are fetched from the backend at RUNTIME
// (via /api/v1/config through the proxy) so nothing depends on build-time NEXT_PUBLIC vars.
let clientPromise: Promise<SupabaseClient> | undefined;

export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const cfg = (await fetch('/api/v1/config').then((r) => r.json())) as { supabaseUrl: string; supabaseAnonKey: string };
      return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sk_auth' },
      });
    })();
  }
  return clientPromise;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await (await getSupabase()).auth.getSession();
  return data.session?.access_token ?? null;
}
