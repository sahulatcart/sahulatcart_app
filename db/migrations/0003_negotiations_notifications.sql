-- 0003_negotiations_notifications.sql — Phase 3 tables
-- negotiations (per-haggle state) + notifications (portal/handoff alerts). Per docs/spec/02.

create type negotiation_status  as enum ('ongoing','agreed','rejected','abandoned');
create type negotiation_scope   as enum ('line','cart');
create type notification_channel as enum ('portal','whatsapp','email');
create type notification_type   as enum ('new_order','payment_claim','takeover_request',
                                         'bot_needs_help','low_stock','template_status','system');

-- ── negotiations ──────────────────────────────────────────────────────────
create table negotiations (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  merchant_id         uuid not null references merchants(id) on delete cascade,
  product_id          uuid references products(id) on delete set null,   -- nullable: cart-scope
  scope               negotiation_scope not null default 'line',
  line_allocations    jsonb,
  quantity            int not null default 1,
  list_price          bigint not null,           -- paisa, snapshot at haggle start
  floor_price         bigint not null,           -- paisa, computed floor (audit; never sent to buyer)
  rounds              int not null default 0,
  last_bot_offer      bigint,
  last_customer_offer bigint,
  final_offered       boolean not null default false,
  status              negotiation_status not null default 'ongoing',
  agreed_price        bigint,                    -- set only on ACCEPT
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_negotiations_convo on negotiations(conversation_id, status, created_at desc);
create trigger trg_negotiations_updated before update on negotiations for each row execute function set_updated_at();

-- ── notifications ─────────────────────────────────────────────────────────
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  user_id     uuid references merchant_users(id) on delete set null,
  type        notification_type not null,
  title       text,
  body        text,
  data        jsonb not null default '{}'::jsonb,   -- NO signed URLs (CD-40): ids only
  channel     notification_channel not null default 'portal',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_notifications_merchant on notifications(merchant_id, read_at, created_at desc);

-- ── RLS (hardened pattern, matches 0002) ──────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['negotiations','notifications'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);
    execute format($f$
      create policy tenant_isolation on %I for all to authenticated
      using (merchant_id = public.jwt_merchant_id() and public.jwt_merchant_id() is not null)
      with check (merchant_id = public.jwt_merchant_id());
    $f$, t);
    execute format($f$
      create policy platform_admin_all on %I for all to authenticated
      using (public.jwt_is_platform_admin());
    $f$, t);
  end loop;
end $$;
