-- 0001_core.sql — Phase 0 core schema
-- Mirrors docs/spec/02-data-model.md. Money = integer paisa (bigint). UUID PKs.
-- Covers the slice needed for Phase 2 (WhatsApp pipe) + Phase 3 catalog/conversation.
-- Orders/payments/negotiations/etc. land in a later Phase-4 migration.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ── Enums ─────────────────────────────────────────────────────────────────
create type merchant_status     as enum ('pending','active','suspended');
create type plan                as enum ('pilot','basic','pro');
create type lang                as enum ('roman_urdu','english','urdu');
create type user_role           as enum ('owner','manager','staff');
create type conversation_status as enum ('bot_active','human_takeover','closed');
create type bot_state           as enum ('greeting','browsing','product_qa','negotiating',
                                         'order_building','collecting_delivery','selecting_payment',
                                         'awaiting_payment_proof','confirming','completed','handoff');
create type message_direction   as enum ('inbound','outbound');
create type message_sender      as enum ('customer','bot','agent','system');
create type message_type        as enum ('text','image','interactive','template','document','audio',
                                         'location','video','sticker','reaction','order');
create type message_status      as enum ('queued','sent','delivered','read','failed');
create type whatsapp_quality    as enum ('green','yellow','red','unknown');
create type whatsapp_tier       as enum ('unverified','tier_1','tier_2','tier_3','tier_4');
create type whatsapp_flag_reason as enum ('quality','token','policy','manual');
create type whatsapp_secret_kind as enum ('access_token');
create type wa_opt_in           as enum ('unknown','in','out');
create type webhook_item_type   as enum ('message','status');
create type webhook_event_status as enum ('received','processed','error','dead_letter');

-- (order/payment/negotiation/job/notification enums created in the Phase-4 migration)

-- ── Helper: updated_at trigger ────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

-- ── platform_admins (cross-tenant operators; NOT a merchant role) ─────────
create table platform_admins (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique not null,
  name          text,
  email         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── merchants (tenant root) ───────────────────────────────────────────────
create table merchants (
  id                   uuid primary key default gen_random_uuid(),
  business_name        text not null,
  owner_name           text,
  email                text unique,
  phone                text,
  status               merchant_status not null default 'pending',
  plan                 plan not null default 'pilot',
  timezone             text not null default 'Asia/Karachi',
  currency             text not null default 'PKR',
  default_language     lang not null default 'roman_urdu',
  category             text,
  agreement_accepted_at timestamptz,
  bot_persona          jsonb not null default '{}'::jsonb,
  negotiation_defaults jsonb not null default
    '{"maxDiscountPct":0,"concessionSteps":[0.5,0.8,1.0],"roundsMax":4,"autoAcceptAtFloor":true}'::jsonb,
  business_hours       jsonb not null default '{}'::jsonb,
  settings             jsonb not null default
    '{"botEnabled":true,"codEnabled":true,"paymentInstructions":"","defaultDeliveryCharge":0,"freeDeliveryThreshold":0,"lowStockThreshold":3,"onboardingCompletedAt":null,"metaCatalog":null}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_merchants_updated before update on merchants for each row execute function set_updated_at();

-- ── merchant_users (portal auth) ──────────────────────────────────────────
create table merchant_users (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references merchants(id) on delete cascade,
  auth_user_id       uuid not null,
  name               text,
  email              text,
  role               user_role not null default 'owner',
  is_active          boolean not null default true,
  notification_prefs jsonb,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (merchant_id, auth_user_id)
);
create index idx_merchant_users_auth on merchant_users(auth_user_id) where is_active;
create trigger trg_merchant_users_updated before update on merchant_users for each row execute function set_updated_at();

-- ── whatsapp_numbers ──────────────────────────────────────────────────────
create table whatsapp_numbers (
  id                   uuid primary key default gen_random_uuid(),
  merchant_id          uuid not null references merchants(id) on delete cascade,
  display_name         text,
  phone_e164           text,
  waba_id              text,
  phone_number_id      text unique not null,           -- inbound routing key
  quality_rating       whatsapp_quality not null default 'unknown',
  messaging_tier       whatsapp_tier not null default 'unverified',
  status               text not null default 'connecting',  -- connecting|connected|flagged|disconnected
  access_token_ref     uuid,                            -- → whatsapp_secrets.id (null/'platform' ⇒ env token)
  token_expires_at     timestamptz,
  token_rotated_at     timestamptz,
  flag_reason          whatsapp_flag_reason,
  verified_name_status text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_wa_numbers_updated before update on whatsapp_numbers for each row execute function set_updated_at();

-- ── whatsapp_secrets (encrypted per-tenant tokens; service-role only) ─────
create table whatsapp_secrets (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  kind        whatsapp_secret_kind not null default 'access_token',
  ciphertext  bytea not null,
  iv          bytea not null,
  auth_tag    bytea not null,
  key_id      text not null,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

-- ── product_categories ────────────────────────────────────────────────────
create table product_categories (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references merchants(id) on delete cascade,
  name               text not null,
  is_prohibited_flag boolean not null default false,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_categories_updated before update on product_categories for each row execute function set_updated_at();

-- ── products ──────────────────────────────────────────────────────────────
create table products (
  id                  uuid primary key default gen_random_uuid(),
  merchant_id         uuid not null references merchants(id) on delete cascade,
  category_id         uuid references product_categories(id) on delete set null,
  sku                 text,
  name                text not null,
  description         text,
  price               bigint not null,      -- paisa (list price)
  cost                bigint,               -- paisa; staff cannot read (enforced in API)
  currency            text not null default 'PKR',
  stock               int,
  track_stock         boolean not null default false,
  images              text[] not null default '{}',
  is_active           boolean not null default true,
  negotiable          boolean not null default false,
  max_discount_pct    numeric,
  min_price           bigint,               -- paisa (absolute floor override)
  external_ref        text,                 -- Meta catalog retailer_id
  external_updated_at timestamptz,
  attributes          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (merchant_id, sku)
);
create index idx_products_active on products(merchant_id, is_active);
create index idx_products_external on products(merchant_id, external_ref);
create trigger trg_products_updated before update on products for each row execute function set_updated_at();

-- ── customers ─────────────────────────────────────────────────────────────
create table customers (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references merchants(id) on delete cascade,
  wa_id            text not null,           -- phone e164
  name             text,
  address          text,
  area             text,
  city             text,
  notes            text,
  tags             text[] not null default '{}',
  is_blocked       boolean not null default false,
  wa_opt_in_status wa_opt_in not null default 'unknown',
  wa_opt_in_source text,
  wa_opt_in_at     timestamptz,
  total_orders     int not null default 0,
  total_spent      bigint not null default 0,   -- paisa
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (merchant_id, wa_id)
);
create trigger trg_customers_updated before update on customers for each row execute function set_updated_at();

-- ── conversations ─────────────────────────────────────────────────────────
create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references merchants(id) on delete cascade,
  customer_id        uuid not null references customers(id) on delete cascade,
  whatsapp_number_id uuid references whatsapp_numbers(id) on delete set null,
  status             conversation_status not null default 'bot_active',
  window_expires_at  timestamptz,
  current_state      bot_state not null default 'greeting',
  context            jsonb not null default '{}'::jsonb,
  assigned_user_id   uuid references merchant_users(id) on delete set null,
  last_message_at    timestamptz,
  unread_count       int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_conversations_inbox on conversations(merchant_id, status, last_message_at desc);
create trigger trg_conversations_updated before update on conversations for each row execute function set_updated_at();

-- ── messages ──────────────────────────────────────────────────────────────
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  merchant_id     uuid not null references merchants(id) on delete cascade,
  direction       message_direction not null,
  sender          message_sender not null,
  type            message_type not null default 'text',
  raw_type        text,
  body            text,
  media_url       text,
  wa_message_id   text unique,
  template_name   text,
  status          message_status not null default 'queued',
  error           text,
  raw             jsonb,
  created_at      timestamptz not null default now()
);
create index idx_messages_conversation on messages(conversation_id, created_at);

-- ── webhook_events (per-inner-item idempotency + debug) ───────────────────
create table webhook_events (
  id           uuid primary key default gen_random_uuid(),
  source       text not null default 'whatsapp',
  event_id     text unique not null,          -- inner messages[].id / statuses[].id
  item_type    webhook_item_type not null,
  status       webhook_event_status not null default 'received',
  attempts     int not null default 0,
  payload      jsonb,
  processed_at timestamptz,
  error        text,
  received_at  timestamptz not null default now()
);

-- ── audit_log ─────────────────────────────────────────────────────────────
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete set null,
  actor       text,
  user_id     uuid,
  action      text,
  entity      text,
  entity_id   uuid,
  diff        jsonb,
  created_at  timestamptz not null default now()
);

-- ── Parent/child merchant_id guard triggers (defense-in-depth, CD-39) ─────
create or replace function assert_child_merchant() returns trigger language plpgsql as $$
declare parent_mid uuid;
begin
  if TG_TABLE_NAME = 'messages' then
    select merchant_id into parent_mid from conversations where id = new.conversation_id;
  end if;
  if parent_mid is not null and parent_mid <> new.merchant_id then
    raise exception 'merchant_id mismatch with parent (%.merchant_id=%, row=%)',
      TG_TABLE_NAME, parent_mid, new.merchant_id;
  end if;
  return new;
end; $$;
create trigger trg_messages_merchant_guard before insert or update on messages
  for each row execute function assert_child_merchant();
