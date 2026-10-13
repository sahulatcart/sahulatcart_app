-- One-off (FR-P2.10), run by Fazal once, after migration 0013 and before the go-live gate ships.
-- The live pilot merchant was created by db/seed.mjs, so it never went through /signup and has no
-- settings.attestations. Readiness fails without them, and after P2 a shop whose bot is switched off
-- could never be switched back on. The owner has accepted both statements in writing; this records it.
-- Everything else the wizard needs (category, hours, persona, test order) the owner fills in through
-- the wizard itself, which is resumable.
--
-- Replace the phone_number_id with META_DEFAULT_PHONE_NUMBER_ID from Railway before running.
update merchants
set settings = settings || jsonb_build_object(
  'attestations', jsonb_build_object('noProhibitedGoods', true, 'optInOnly', true, 'at', now())
)
where id = (select merchant_id from whatsapp_numbers where phone_number_id = '<META_DEFAULT_PHONE_NUMBER_ID>')
  and (settings->'attestations') is null;
-- Expect: UPDATE 1. Record the date in CHANGELOG.
