-- 0007_lock_direct_table_access.sql — no direct table access from browsers.
-- The portal uses Supabase only to sign in; every read and write goes through the backend
-- (service role), which is where roles are enforced. But the anon key is public and every
-- user holds a JWT, and the tenant_isolation policies are `for all` and role-blind — so any
-- member, staff included, could call PostgREST directly to raise their own role in
-- merchant_users, mark a payment verified, or read products.cost. RLS stays on as defence
-- in depth; the grants below simply stop anon/authenticated reaching the tables at all.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- Functions cannot be locked by default the same way: PUBLIC's execute right is global in
-- Postgres and can't be revoked per schema. Every new function must therefore end with
--   revoke execute on function <fn> from public, anon, authenticated;
-- as 0006 does for next_order_number — otherwise anyone can call it via /rest/v1/rpc.

-- The auth hook is for Supabase Auth only (it keeps its supabase_auth_admin grant). Callable
-- by anyone, it returns any user's merchant_id and role for a guessed user id.
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
