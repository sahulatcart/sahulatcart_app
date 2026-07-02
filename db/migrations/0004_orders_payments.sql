-- 0004_orders_payments.sql — Phase 4 order + payment tables (per docs/spec/02).
-- Money in paisa. Order/payment lifecycle per doc 10 CD-15/16/17/18.

create type order_status   as enum ('draft','pending_confirmation','confirmed','awaiting_payment',
                                    'paid','preparing','dispatched','delivered','cancelled','returned');
create type payment_method as enum ('unset','cod','bank_transfer');
create type payment_status as enum ('unpaid','claimed','verified','failed','cod_pending','cod_collected','refunded');
create type discount_source as enum ('negotiated','manual','coupon','none');
create type claim_status   as enum ('claimed','verified','rejected');

-- ── bank_accounts (merchant's OWN accounts shown to buyers) ────────────────
create table bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchants(id) on delete cascade,
  bank_name      text not null,
  account_title  text not null,
  account_number text not null,
  iban           text,
  branch         text,
  is_default     boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_bank_accounts_updated before update on bank_accounts for each row execute function set_updated_at();

-- ── delivery_zones ─────────────────────────────────────────────────────────
create table delivery_zones (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchants(id) on delete cascade,
  area_name      text not null,
  city           text,
  charge         bigint not null default 0,   -- paisa
  is_serviceable boolean not null default true,
  eta_text       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_delivery_zones_updated before update on delivery_zones for each row execute function set_updated_at();

-- ── orders ─────────────────────────────────────────────────────────────────
create table orders (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references merchants(id) on delete cascade,
  customer_id      uuid not null references customers(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  order_number     text,                        -- assigned at confirmed
  status           order_status not null default 'draft',
  payment_method   payment_method not null default 'unset',
  payment_status   payment_status not null default 'unpaid',
  payment_locked   boolean not null default false,
  subtotal         bigint not null default 0,
  discount_total   bigint not null default 0,
  delivery_charge  bigint not null default 0,
  total            bigint not null default 0,
  delivery_name    text,
  delivery_phone   text,
  delivery_address text,
  delivery_area    text,
  delivery_city    text,
  notes            text,
  slip_url         text,
  placed_at        timestamptz,
  cancelled_reason text,
  returned_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (merchant_id, order_number)
);
create index idx_orders_merchant_status on orders(merchant_id, status, created_at desc);
create trigger trg_orders_updated before update on orders for each row execute function set_updated_at();

-- ── order_items (merchant_id denormalized for RLS) ────────────────────────
create table order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  merchant_id         uuid not null references merchants(id) on delete cascade,
  product_id          uuid references products(id) on delete set null,
  name_snapshot       text not null,
  unit_price          bigint not null,        -- list price snapshot (paisa)
  quantity            int not null default 1,
  discount            bigint not null default 0,  -- total line discount (paisa)
  negotiated_discount bigint not null default 0,
  discount_source     discount_source not null default 'none',
  negotiation_id      uuid references negotiations(id) on delete set null,
  line_total          bigint not null         -- = unit_price*qty - discount
);
create index idx_order_items_order on order_items(order_id);

-- ── payments (1:1 current-state row) ──────────────────────────────────────
create table payments (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null unique references orders(id) on delete cascade,
  merchant_id            uuid not null references merchants(id) on delete cascade,
  method                 payment_method not null,
  amount                 bigint not null,
  status                 payment_status not null default 'unpaid',
  bank_account_id        uuid references bank_accounts(id) on delete set null,
  screenshot_url         text,
  claimed_at             timestamptz,
  verified_at            timestamptz,
  verified_by_user_id    uuid references merchant_users(id) on delete set null,
  cod_collected_at       timestamptz,
  cod_collected_by_user_id uuid references merchant_users(id) on delete set null,
  refunded_at            timestamptz,
  refund_reason          text,
  rejection_reason       text,
  reference              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_payments_updated before update on payments for each row execute function set_updated_at();

-- ── payment_claims (full claim history) ───────────────────────────────────
create table payment_claims (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references payments(id) on delete cascade,
  order_id           uuid not null references orders(id) on delete cascade,
  merchant_id        uuid not null references merchants(id) on delete cascade,
  screenshot_url     text,
  reference          text,
  amount             bigint not null,
  status             claim_status not null default 'claimed',
  rejection_reason   text,
  claimed_at         timestamptz not null default now(),
  decided_at         timestamptz,
  decided_by_user_id uuid references merchant_users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index idx_payment_claims_order on payment_claims(order_id, created_at desc);

-- ── order_status_history ──────────────────────────────────────────────────
create table order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  changed_by  text not null default 'system',   -- bot | agent | system
  user_id     uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index idx_order_status_history_order on order_status_history(order_id, created_at);

-- ── RLS (hardened pattern, matches 0002/0003) ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['bank_accounts','delivery_zones','orders','order_items',
                           'payments','payment_claims'] loop
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
-- order_status_history via parent order; service-role writes only for now.
alter table order_status_history enable row level security;
alter table order_status_history force row level security;
