-- 0014_push_subscriptions.sql — Web Push subscriptions for merchant alerts (SRS P3).
-- One row per browser/device a portal member turned notifications on in. The endpoint is the
-- push service's URL for that device and is unique across everyone. p256dh/auth are the keys the
-- browser handed us; they are secrets for that device only (pino redacts `*.auth`).
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  member_id    uuid not null references merchant_users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index idx_push_subscriptions_member on push_subscriptions(member_id);

-- RLS on with no policies: only the service role (backend) can touch it (same as merchant_counters, 0006).
alter table push_subscriptions enable row level security;
grant select, insert, update, delete on push_subscriptions to service_role;
