-- 0008_stock_reservation.sql — orders take their items out of stock.
-- Stock was only ever *checked* (stock <= 0), never reduced, so the bot could sell the same
-- last unit to every buyer. An order now reserves its items when it is placed (COD confirm or
-- bank-transfer awaiting payment) and gives them back when it is cancelled. Only products with
-- track_stock = true and a known stock count are touched.

-- Makes reserve/release idempotent: each happens at most once per order.
alter table orders add column stock_reserved boolean not null default false;

-- All or nothing: false (and no change at all) if any tracked item is short.
create function reserve_stock(p_order uuid) returns boolean
language plpgsql as $$
declare r record;
begin
  update orders set stock_reserved = true where id = p_order and not stock_reserved;
  if not found then return true; end if; -- already reserved
  for r in
    select product_id, sum(quantity)::int as qty from order_items
    where order_id = p_order and product_id is not null group by product_id
  loop
    update products set stock = stock - r.qty
    where id = r.product_id and track_stock and stock is not null and stock >= r.qty;
    if not found and exists (select 1 from products where id = r.product_id and track_stock and stock is not null) then
      raise exception 'insufficient stock' using errcode = 'P0001';
    end if;
  end loop;
  return true;
exception when sqlstate 'P0001' then
  return false; -- the block rolls back, including stock_reserved
end $$;

create function release_stock(p_order uuid) returns void
language plpgsql as $$
begin
  update orders set stock_reserved = false where id = p_order and stock_reserved;
  if not found then return; end if; -- nothing reserved, or already released
  update products p set stock = p.stock + i.qty
  from (select product_id, sum(quantity)::int as qty from order_items where order_id = p_order group by product_id) i
  where p.id = i.product_id and p.track_stock and p.stock is not null;
end $$;

revoke execute on function reserve_stock(uuid), release_stock(uuid) from public, anon, authenticated;
grant execute on function reserve_stock(uuid), release_stock(uuid) to service_role;
