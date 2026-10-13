-- Review P2-11: the bot matches delivery areas by whole words, so one area twice (any case or
-- spacing) would make the match arbitrary. The route already refuses it; this makes the race safe.
create unique index if not exists delivery_zones_one_area
  on delivery_zones (merchant_id, lower(btrim(area_name)));
