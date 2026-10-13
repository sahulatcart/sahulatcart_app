-- P5 (FR-P5.4): products are soft-deleted because order_items reference them.
alter table products add column if not exists deleted_at timestamptz;
