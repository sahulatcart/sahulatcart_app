-- 0002_rls_and_auth_hook.sql — hardened RLS + Supabase Custom Access Token Hook
-- Implements docs/spec CD-35 (hardened RLS) and CD-36 (auth hook). Tenant isolation
-- depends ENTIRELY on the hook injecting the merchant_id/role/platform_admin claims.

-- ── Custom Access Token Hook (CD-36) ──────────────────────────────────────
-- Injects merchant_id + role (from merchant_users) and platform_admin (from
-- platform_admins). Deactivated users get NO merchant_id claim ⇒ default-deny.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims       jsonb := coalesce(event->'claims', '{}'::jsonb);
  v_user_id    uuid  := (event->>'user_id')::uuid;
  v_merchant   uuid;
  v_role       text;
  v_platform   boolean := false;
begin
  select mu.merchant_id, mu.role::text
    into v_merchant, v_role
  from public.merchant_users mu
  where mu.auth_user_id = v_user_id
    and mu.is_active = true
  order by mu.created_at asc      -- deterministic if user maps to multiple merchants
  limit 1;

  if v_merchant is not null then
    claims := jsonb_set(claims, '{merchant_id}', to_jsonb(v_merchant::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
  end if;

  select true into v_platform
  from public.platform_admins pa
  where pa.auth_user_id = v_user_id and pa.is_active = true
  limit 1;

  if v_platform then
    claims := jsonb_set(claims, '{platform_admin}', 'true'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Supabase auth runs the hook as role supabase_auth_admin.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.merchant_users, public.platform_admins to supabase_auth_admin;
-- NOTE: enable the hook in Supabase → Authentication → Hooks (Custom Access Token)
--       pointing at public.custom_access_token_hook.

-- ── Reusable claim helpers ────────────────────────────────────────────────
create or replace function public.jwt_merchant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'merchant_id','')::uuid;
$$;

create or replace function public.jwt_is_platform_admin() returns boolean
language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'platform_admin')::boolean, false);
$$;

-- ── Hardened RLS pattern (CD-35) applied to every tenant table ────────────
do $$
declare t text;
begin
  foreach t in array array[
    'merchants','merchant_users','whatsapp_numbers','product_categories',
    'products','customers','conversations','messages','audit_log'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);

    -- tenant isolation: only rows of the caller's merchant, fail-closed on missing claim
    if t = 'merchants' then
      execute format($f$
        create policy tenant_isolation on %I for all to authenticated
        using (id = public.jwt_merchant_id() and public.jwt_merchant_id() is not null)
        with check (id = public.jwt_merchant_id());
      $f$, t);
    else
      execute format($f$
        create policy tenant_isolation on %I for all to authenticated
        using (merchant_id = public.jwt_merchant_id() and public.jwt_merchant_id() is not null)
        with check (merchant_id = public.jwt_merchant_id());
      $f$, t);
    end if;

    -- platform-admin cross-tenant bypass
    execute format($f$
      create policy platform_admin_all on %I for all to authenticated
      using (public.jwt_is_platform_admin());
    $f$, t);
  end loop;
end $$;

-- ── whatsapp_secrets: service-role ONLY (deny portal/anon entirely) ───────
alter table whatsapp_secrets enable row level security;
alter table whatsapp_secrets force row level security;
-- no policy for `authenticated` ⇒ authenticated/anon get nothing; the backend
-- reaches this table with the service role (RLS bypass) or the restricted worker role.

-- platform_admins: readable only by platform admins themselves
alter table platform_admins enable row level security;
alter table platform_admins force row level security;
create policy platform_admins_self on platform_admins for all to authenticated
  using (public.jwt_is_platform_admin());

-- webhook_events: service-role only (no authenticated policy)
alter table webhook_events enable row level security;
alter table webhook_events force row level security;
