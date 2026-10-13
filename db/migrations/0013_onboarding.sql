-- 0013_onboarding.sql — onboarding with readiness gates (SRS P2).
-- Two columns the wizard's first panel writes. delivery_zones, bank_accounts, bot_persona,
-- business_hours and settings already exist (0001, 0004). business_hours is
--   { "mon": { "open": "10:00", "close": "22:00" }, "fri": { "closed": true }, ... }
-- and "at least one day set" means one key with open and close.
alter table merchants
  add column logo_url text,
  add column address  text;
