-- Inventory ledger and purchasing (FR-INV-04..07, ENG-01, ENG-06): a technician counts only their own truck,
-- the office receives, the ledger is append-only, orders are numbered per business, one preferred package per product.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(16);

create temp table fx on commit drop as select pg_temp.seed_tenant('inv1') as a, pg_temp.seed_tenant('inv2') as b;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'tech_user')::uuid as tech_user, (a ->> 'office')::uuid as office, (a ->> 'owner')::uuid as owner,
       (a ->> 'product')::uuid as product, (a ->> 'truck')::uuid as truck, (a ->> 'shop')::uuid as shop, (a ->> 'vendor')::uuid as vendor,
       (a ->> 'vendor_product')::uuid as vendor_product, (a ->> 'purchase_order_line')::uuid as po_line,
       (b ->> 'tenant')::uuid as other_tenant, (b ->> 'truck')::uuid as other_truck
from fx;
grant select on ids to authenticated;

-- A second truck in the first business, owned by nobody who is logged in.
insert into public.technicians (tenant_id, display_name, applicator_license_no, license_expiry)
select tenant, 'Second tech', 'UT-inv1-0043', date '2027-12-31' from ids;
insert into public.stock_locations (tenant_id, kind, name, technician_id)
select i.tenant, 'truck', 'Truck 2', t.id from ids i join public.technicians t on t.tenant_id = i.tenant and t.display_name = 'Second tech';
create temp table truck2 on commit drop as select id from public.stock_locations where name = 'Truck 2';
grant select on truck2 to authenticated;

select pg_temp.login((select tech_user from ids), (select tenant from ids));
select lives_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, local_date, client_key)
    values ((select truck from ids), (select product from ids), 'count', 40, 'fl_oz', date '2026-10-13', 'inv-count-0001')$$,
  'FR-INV-07: a technician counts their own truck');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, local_date, client_key)
    values ((select id from truck2), (select product from ids), 'count', 40, 'fl_oz', date '2026-10-13', 'inv-count-0002')$$,
  '42501', null, 'FR-INV-07: but not another truck in the same business');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, local_date, client_key)
    values ((select other_truck from ids), (select product from ids), 'count', 40, 'fl_oz', date '2026-10-13', 'inv-count-0003')$$,
  '42501', null, 'DB-02: nor another business''s truck');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, client_key, cost_cents)
    values ((select truck from ids), (select product from ids), 'receive', 5, 'fl_oz', 'inv-receive-0001', 100)$$,
  '42501', null, 'a technician cannot receive stock');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, client_key, reason)
    values ((select truck from ids), (select product from ids), 'adjust', -5, 'fl_oz', 'inv-adjust-0001', 'spilled')$$,
  '42501', null, 'or adjust it');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, local_date, client_key)
    values ((select truck from ids), (select product from ids), 'count', 40, 'fl_oz', date '2026-10-13', 'inv-count-0001')$$,
  '23505', null, 'ENG-01: the same client key is stored once');
reset role;

select pg_temp.login((select office from ids), (select tenant from ids));
select lives_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, cost_cents, purchase_order_line_id, client_key)
    values ((select shop from ids), (select product from ids), 'receive', 256, 'fl_oz', 17800, (select po_line from ids), 'po:line:receive')$$,
  'FR-INV-06: the office receives an order into the shop');
select throws_ok($$update public.stock_movements set qty = 1$$, '42501', null, 'ENG-06: movements are never rewritten');
select throws_ok($$delete from public.stock_movements$$, '42501', null, 'or deleted');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, client_key)
    values ((select shop from ids), (select product from ids), 'receive', -5, 'fl_oz', 'inv-receive-0002')$$,
  '23514', null, 'a receipt adds stock: the sign is checked');
select throws_ok(
  $$insert into public.stock_movements (location_id, product_id, kind, qty, unit, client_key, transfer_id)
    values ((select shop from ids), (select product from ids), 'transfer_out', 5, 'fl_oz', 'inv-xfer-0001', gen_random_uuid())$$,
  '23514', null, 'a transfer out removes stock: the sign is checked');

reset role;
select pg_temp.login((select owner from ids), (select tenant from ids));
insert into public.purchase_orders (vendor_id) select vendor from ids;
select ok(
  (select count(distinct number) = 2 and max(number) - min(number) = 1 from public.purchase_orders),
  'FR-INV-05: purchase order numbers count up per business (seed order plus the new one)');
select throws_ok(
  $$insert into public.vendor_products (vendor_id, product_id, package_label, package_qty, package_unit, preferred)
    values ((select vendor from ids), (select product from ids), '5 gal pail', 5, 'gal', true)$$,
  '23505', null, 'FR-INV-04: one preferred package per product');
select lives_ok(
  $$insert into public.vendor_products (vendor_id, product_id, package_label, package_qty, package_unit, preferred)
    values ((select vendor from ids), (select product from ids), '5 gal pail', 5, 'gal', false)$$,
  'FR-INV-04: other packages may be listed unpreferred');
reset role;

select pg_temp.login((select tech_user from ids), (select other_tenant from ids));
select is((select count(*)::int from public.stock_movements where tenant_id = (select tenant from ids)), 0, 'DB-02: another business sees none of this ledger');
select is((select count(*)::int from public.vendors), 0, 'nor its vendors');
reset role;

select * from finish();
rollback;
