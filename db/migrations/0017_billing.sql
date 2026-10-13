-- 0017_billing.sql — plans, trial, invoices (SRS P7). Prices and conversation limits are code/config
-- (shared/src/plans.ts, PLAN_*_PRICE_PAISA); the tables hold only what was agreed and what was paid.
-- Payment is by bank transfer to Nubrix and marked by hand in the platform console (M6). Nothing
-- here ever touches money (invariant 2).

create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  merchant_id           uuid not null references merchants(id) on delete cascade unique,
  plan                  plan not null default 'pilot',
  status                text not null default 'trial' check (status in ('trial','active','past_due','expired')),
  trial_ends_at         timestamptz,
  trial_warned_at       timestamptz,                 -- the "7 days left" notice went out
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  requested_plan        plan,                        -- a change the merchant asked for; the console applies it
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_subscriptions_merchant on subscriptions(merchant_id);

create table invoices (
  id                        uuid primary key default gen_random_uuid(),
  merchant_id               uuid not null references merchants(id) on delete cascade,
  subscription_id           uuid not null references subscriptions(id) on delete cascade,
  plan                      plan not null,
  period_start              timestamptz not null,
  period_end                timestamptz not null,
  amount_paisa              bigint not null check (amount_paisa >= 0),
  status                    text not null default 'due' check (status in ('due','paid','void')),
  reference                 text,                    -- the merchant's transfer reference ("I've paid, ref …")
  claimed_at                timestamptz,
  paid_at                   timestamptz,
  marked_by_platform_admin  uuid,                    -- auth.users id of whoever marked it paid
  created_at                timestamptz not null default now(),
  unique (subscription_id, period_start)             -- the monthly job is idempotent
);
create index idx_invoices_merchant on invoices(merchant_id);
create index idx_invoices_due on invoices(status) where status = 'due';

-- Every shop that exists today starts a 30-day free pilot from now (the live pilot merchant included).
insert into subscriptions (merchant_id, plan, status, trial_ends_at)
select id, plan, 'trial', now() + interval '30 days' from merchants
on conflict (merchant_id) do nothing;

-- Browsers get no table access (0007 default privileges); the backend's service role does.
alter table subscriptions enable row level security;
alter table invoices enable row level security;
grant select, insert, update, delete on subscriptions to service_role;
grant select, insert, update, delete on invoices to service_role;
