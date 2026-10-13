-- 0010_message_templates.sql — WhatsApp message templates per merchant, and the paid buyer notice
-- an order may be waiting for (docs/launch/SRS-Fazal.md M4). Column names follow
-- docs/spec/02-data-model.md.

create table message_templates (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references merchants(id) on delete cascade,
  waba_id          text not null,
  wa_template_id   text,
  name             text not null,
  language         text not null default 'en',
  category         text not null default 'utility',
  status           text not null default 'pending',   -- pending|approved|rejected|paused|disabled
  rejection_reason text,
  body_json        jsonb not null,                     -- the components sent to Meta
  param_count      int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (merchant_id, name)
);
create index message_templates_waba on message_templates(waba_id, name);
create trigger trg_message_templates_updated before update on message_templates
  for each row execute function set_updated_at();

-- A notice the bot could not send for free (the buyer's 24-hour window had closed). The order page
-- shows a paid button for it; null once sent or not needed.
alter table orders add column pending_buyer_notice text;   -- null | payment_update | order_sent
