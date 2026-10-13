-- 0011_message_usage.sql — the per-shop message meter and AI-call counter (SRS-Fazal M5).
-- Since 1 October 2026 every WhatsApp message past 1,000 a month per number is charged, so each
-- shop sees "N of 1,000 free used" and chooses what happens after. One row per number per month;
-- llm_calls is a per-day counter kept in the same row (reset when the day changes).

create table message_usage (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete cascade,
  phone_number_id text not null,
  period_month    text not null,                 -- 'YYYY-MM' in Asia/Karachi
  outbound_count  int  not null default 0,
  inbound_count   int  not null default 0,
  llm_calls       int  not null default 0,
  llm_calls_day   date not null default (now() at time zone 'Asia/Karachi')::date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (merchant_id, phone_number_id, period_month)
);
create index message_usage_merchant_month on message_usage(merchant_id, period_month);
create trigger trg_message_usage_updated before update on message_usage
  for each row execute function set_updated_at();

-- Atomic increment, so concurrent sends never lose a count. The merchant is resolved from the
-- number, so callers (the WhatsApp client, the webhook, the AI wrapper) need only the phone id.
-- Returns the row's new totals; nothing for a number we do not hold.
create function bump_message_usage(p_phone text, p_month text, p_outbound int, p_inbound int, p_llm int)
returns table(merchant_id uuid, outbound_count int, inbound_count int, llm_calls int)
language plpgsql volatile as $$
declare
  v_mid   uuid;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  select n.merchant_id into v_mid from whatsapp_numbers n where n.phone_number_id = p_phone;
  if v_mid is null then return; end if;
  insert into message_usage as u (merchant_id, phone_number_id, period_month, outbound_count, inbound_count, llm_calls, llm_calls_day)
    values (v_mid, p_phone, p_month, p_outbound, p_inbound, p_llm, v_today)
  on conflict (merchant_id, phone_number_id, period_month) do update set
    outbound_count = u.outbound_count + excluded.outbound_count,
    inbound_count  = u.inbound_count + excluded.inbound_count,
    llm_calls      = case when u.llm_calls_day = v_today then u.llm_calls + excluded.llm_calls else excluded.llm_calls end,
    llm_calls_day  = v_today
  returning u.merchant_id, u.outbound_count, u.inbound_count, u.llm_calls
    into merchant_id, outbound_count, inbound_count, llm_calls;
  return next;
end $$;
revoke execute on function bump_message_usage(text, text, int, int, int) from public, anon, authenticated;
grant execute on function bump_message_usage(text, text, int, int, int) to service_role;
