-- 0012_self_signup.sql — self-service signup (SRS P1).
-- A merchant used to be created only by the platform admin's API call. Now the portal's
-- /auth/confirmed page calls POST /api/v1/signup/bootstrap after the email is confirmed, and
-- that calls create_merchant_for_user() with the auth user id taken from the verified JWT.

-- One user, one shop. merchant_users was unique on (merchant_id, auth_user_id) only, so two
-- bootstrap calls racing (a double-click, two tabs) could both see "no shop yet" and create two.
create unique index merchant_users_one_shop on merchant_users(auth_user_id);

-- A new shop must never answer buyers before onboarding: botEnabled was true by default.
alter table merchants alter column settings set default
  '{"botEnabled":false,"codEnabled":true,"paymentInstructions":"","defaultDeliveryCharge":0,"freeDeliveryThreshold":0,"lowStockThreshold":3,"onboardingCompletedAt":null,"metaCatalog":null}'::jsonb;

-- Idempotent: a user who already owns a shop gets that shop back. The unique index above turns
-- the race into a unique_violation, which is caught and answered with the shop that won.
-- p_phone is stored as given; the backend normalises it to digits only before calling (Part 0.3).
create function create_merchant_for_user(
  p_auth_user uuid, p_email text, p_shop text, p_owner text, p_phone text, p_attestations jsonb default null
) returns table(merchant_id uuid, role user_role)
language plpgsql volatile as $$
declare
  v_mid uuid;
  v_settings jsonb;
begin
  select mu.merchant_id, mu.role into merchant_id, role
    from merchant_users mu where mu.auth_user_id = p_auth_user and mu.is_active limit 1;
  if found then return next; return; end if;

  v_settings := '{"botEnabled":false,"codEnabled":true,"paymentInstructions":"","defaultDeliveryCharge":0,"freeDeliveryThreshold":0,"lowStockThreshold":3,"onboardingCompletedAt":null,"metaCatalog":null}'::jsonb;
  if p_attestations is not null then
    v_settings := v_settings || jsonb_build_object('attestations', p_attestations);
  end if;

  begin
    insert into merchants (business_name, owner_name, email, phone, status, settings)
      values (p_shop, p_owner, p_email, p_phone, 'active', v_settings)
      returning id into v_mid;
    insert into merchant_users (merchant_id, auth_user_id, email, name, role, is_active)
      values (v_mid, p_auth_user, p_email, p_owner, 'owner', true);
  exception when unique_violation then
    -- Another bootstrap for the same user won the race (or the email already has a shop):
    -- undo our half-written merchant, if any, and return the existing membership.
    if v_mid is not null then delete from merchants where id = v_mid; end if;
    select mu.merchant_id, mu.role into merchant_id, role
      from merchant_users mu where mu.auth_user_id = p_auth_user and mu.is_active limit 1;
    if found then return next; return; end if;
    raise;
  end;

  merchant_id := v_mid;
  role := 'owner';
  return next;
end $$;
revoke execute on function create_merchant_for_user(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function create_merchant_for_user(uuid, text, text, text, text, jsonb) to service_role;
