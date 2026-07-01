import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';

/**
 * Service-role client — bypasses RLS. Used by the bot/worker path, which is
 * therefore responsible for stamping merchant_id correctly on every write
 * (defense-in-depth: parent/child CHECK triggers in db/0001; restricted worker
 * role to be introduced in Phase 6 per CD-39).
 */
let serviceClient: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const cfg = loadConfig();
  serviceClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}
