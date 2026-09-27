-- 0006_order_counters.sql — atomic per-merchant order numbers.
-- Order numbers used to be COUNT(*)+1: two checkouts at the same moment got the same
-- number (the second confirm then failed silently on unique(merchant_id, order_number)),
-- and deleting any order made every later number collide forever. One counter row per
-- merchant, bumped by a single upsert, cannot race.

create table merchant_counters (
  merchant_id   uuid primary key references merchants(id) on delete cascade,
  last_order_no int  not null
);

-- Carry on from the highest number already issued ('SK-1042' → 1042).
insert into merchant_counters (merchant_id, last_order_no)
select merchant_id, max(substring(order_number from '[0-9]+$')::int)
from orders
where order_number ~ '[0-9]+$'
group by merchant_id;

-- RLS on with no policies: only the service role (backend) can touch it.
alter table merchant_counters enable row level security;
grant select, insert, update on merchant_counters to service_role;

create function next_order_number(p_merchant uuid) returns text
language sql volatile as $$
  insert into merchant_counters as c (merchant_id, last_order_no) values (p_merchant, 1001)
  on conflict (merchant_id) do update set last_order_no = c.last_order_no + 1
  returning 'SK-' || c.last_order_no;
$$;
revoke execute on function next_order_number(uuid) from public, anon, authenticated;
grant execute on function next_order_number(uuid) to service_role;
