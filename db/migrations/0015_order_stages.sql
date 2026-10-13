-- 0015_order_stages.sql — order stages after "paid" (SRS P4).
-- preparing / dispatched / delivered already exist in order_status (0004); nothing set them.
-- Dispatch records how the parcel went, for the buyer's notice and the order page.
alter table orders
  add column courier      text,
  add column tracking_ref text,
  add column eta_text     text;
