-- 0019_bootstrap_conflicts.sql — review P1-5: create_merchant_for_user() tells the two conflicts
-- apart instead of raising the raw unique_violation that signup.ts echoed as a 400.
--   SC001 inactive_membership — this login once belonged to a shop and was deactivated (the
--                               one-shop-ever index would refuse a second); support reinstates it.
--   SC002 email_in_use        — merchants.email is unique and another shop already uses it.
-- Anything else still raises, and the route answers 500 with plain copy.
-- The old exception block's `delete from merchants` was a no-op (the subtransaction had already
-- rolled back) and is gone.
create or replace function create_merchant_for_user(
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

  if exists (select 1 from merchant_users mu where mu.auth_user_id = p_auth_user) then
    raise exception 'inactive_membership' using errcode = 'SC001';
  end if;
  if exists (select 1 from merchants m where lower(m.email) = lower(p_email)) then
    raise exception 'email_in_use' using errcode = 'SC002';
  end if;

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
    -- Another bootstrap for the same user won the race: return the membership it created.
    select mu.merchant_id, mu.role into merchant_id, role
      from merchant_users mu where mu.auth_user_id = p_auth_user and mu.is_active limit 1;
    if found then return next; return; end if;
    raise exception 'email_in_use' using errcode = 'SC002';
  end;

  merchant_id := v_mid;
  role := 'owner';
  return next;
end $$;
revoke execute on function create_merchant_for_user(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function create_merchant_for_user(uuid, text, text, text, text, jsonb) to service_role;
