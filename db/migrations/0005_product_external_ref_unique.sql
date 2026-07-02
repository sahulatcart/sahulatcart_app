-- 0005: unique index for Meta catalog sync upsert (by retailer_id → products.external_ref).
create unique index if not exists uq_products_external
  on products(merchant_id, external_ref)
  where external_ref is not null;
