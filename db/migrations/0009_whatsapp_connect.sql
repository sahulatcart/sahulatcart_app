-- 0009_whatsapp_connect.sql — per-merchant WhatsApp credentials and the connect flow
-- (docs/launch/SRS-Fazal.md M1–M3). Everything here is additive.
--
-- The migration runner wraps this file in one transaction. Postgres allows adding enum values
-- inside it but forbids USING them in the same transaction, so nothing below inserts a 'pin'
-- secret or an 'event' webhook row; the code does that at runtime.

-- M2: the registration PIN is stored encrypted beside the access token.
alter type whatsapp_secret_kind add value 'pin';

-- M3: account-level webhook fields (template status, number quality, account updates) are
-- claimed in webhook_events like messages are, under their own item type.
alter type webhook_item_type add value 'event';

-- M2: every Embedded Signup attempt, for support and for idempotency on the Meta code.
create table whatsapp_connect_attempts (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete cascade,
  member_id       uuid references merchant_users(id) on delete set null,
  status          text not null default 'started',
    -- started|token_ok|verified|subscribed|registered|awaiting_handshake|connected|failed
  code_hash       text unique,          -- sha256 of the single-use Meta code
  waba_id         text,
  phone_number_id text,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index whatsapp_connect_attempts_merchant on whatsapp_connect_attempts(merchant_id, created_at desc);
create trigger trg_whatsapp_connect_attempts_updated before update on whatsapp_connect_attempts
  for each row execute function set_updated_at();

-- M2/M3: the handshake time and the plain-words reason a number needs attention.
alter table whatsapp_numbers
  add column last_test_at      timestamptz,
  add column attention_message text;

-- M1: a number that cannot send is 'needs_attention' (with flag_reason) or 'disconnected';
-- the old 'flagged' value is never written by the code.
comment on column whatsapp_numbers.status is 'connecting|connected|needs_attention|disconnected';

-- M1: the token lookup goes access_token_ref → whatsapp_secrets.id; this covers listing a
-- merchant's secrets by kind (connect, disconnect).
create index whatsapp_secrets_merchant_kind on whatsapp_secrets(merchant_id, kind);
