-- One-off (FR-P2.10), run by Fazal once, after migration 0013 and before the go-live gate ships.
-- The live pilot merchant was created by db/seed.mjs, so it never went through /signup and has no
-- settings.attestations. Readiness fails without them, and after P2 a shop whose bot is switched off
-- could never be switched back on. The owner has accepted both statements in writing; this records it.
-- Everything else the wizard needs (category, hours, persona, test order) the owner fills in through
-- the wizard itself, which is resumable.
--
-- Keyed on the seed's email (db/seed.mjs), which needs no value from Railway (review P2-1).
update merchants
set settings = settings || jsonb_build_object(
  'attestations', jsonb_build_object('noProhibitedGoods', true, 'optInOnly', true, 'at', now())
)
where email = 'pilot@sahulatcart.test'
  and (settings->'attestations') is null
returning id;
-- Expect: UPDATE 1 and one id. Record the date in CHANGELOG, then walk the pilot through the wizard.
-- Until it has run, nobody presses Pause on the pilot: the gate could not let it back on.
