-- 0020_platform_panel.sql — the founders' panel (docs/launch/PLATFORM-PANEL-*.md):
-- founders' inbox, job heartbeats, sign-up settings in the database, admins invited by email.

create table platform_notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('invoice_claimed','plan_requested','whatsapp_attention','job_failed')),
  merchant_id uuid references merchants(id) on delete set null,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,   -- ids and codes only: never message text, never buyer data
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index platform_notifications_unread on platform_notifications (created_at desc) where read_at is null;

-- One row per job, overwritten on every run. A heartbeat, not a history.
create table job_runs (
  job              text primary key,                -- replay_sweeper | retention | unpaid_expiry | billing
  interval_seconds integer not null,
  started_at       timestamptz not null,
  finished_at      timestamptz,
  ok               boolean,
  error            text,
  summary          jsonb not null default '{}'::jsonb
);

-- signup_open: true/false. signup_allowlist: a JSON array of lowercased emails.
create table platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- An admin invited by email has no auth user until their first confirmed login (platformAdminFor).
-- The unique constraint on auth_user_id stays; Postgres allows many nulls in it. The 0002 auth hook
-- and the platform_admins_self policy match on auth_user_id, so an unbound row gets no claim, and
-- nothing in the backend reads that claim.
alter table platform_admins alter column auth_user_id drop not null;
create unique index platform_admins_email on platform_admins (lower(email));

-- Browsers get no table access (0007 default privileges); the backend's service role does.
alter table platform_notifications enable row level security;
alter table job_runs enable row level security;
alter table platform_settings enable row level security;
grant select, insert, update, delete on platform_notifications, job_runs, platform_settings to service_role;
