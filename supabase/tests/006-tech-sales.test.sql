-- FR-SAL-01..04: technicians add customers only when the owner allows it, only
-- credited to themselves, and never write their own commission.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(17);

create temp table fx on commit drop as select pg_temp.seed_tenant('s') as s;
create temp table ids on commit drop as
select
  (s ->> 'tenant')::uuid as tenant,
  (s ->> 'owner')::uuid as owner,
  (s ->> 'office')::uuid as office,
  (s ->> 'tech_user')::uuid as tech_user,
  (s ->> 'technician')::uuid as technician,
  (s ->> 'plan')::uuid as plan,
  (s ->> 'service_type')::uuid as service_type,
  (s ->> 'customer')::uuid as customer
from fx;
-- A second technician, with a sale of their own.
alter table ids add column other_tech uuid, add column other_customer uuid;
insert into public.technicians (tenant_id, user_id, display_name, applicator_license_no, license_expiry)
values ((select tenant from ids), pg_temp.new_user('other-tech@test.routeverde.dev'), 'Other Tech', 'UT-OTHER-1', date '2027-12-31');
update ids set other_tech = (select id from public.technicians where display_name = 'Other Tech');
insert into public.customers (tenant_id, display_name, sold_by_technician_id) values ((select tenant from ids), 'Other Sale', (select other_tech from ids));
update ids set other_customer = (select id from public.customers where display_name = 'Other Sale');
insert into public.commissions (tenant_id, technician_id, customer_id, basis_cents, flat_cents, pct, amount_cents)
values ((select tenant from ids), (select other_tech from ids), (select other_customer from ids), 0, 1000, 0, 1000);
grant select on ids to authenticated;

-- Off by default -----------------------------------------------------------------------
select pg_temp.login((select tech_user from ids), (select tenant from ids));
select throws_ok(
  format($$insert into public.customers (display_name, sold_by_technician_id) values ('Door One', %L)$$, (select technician from ids)),
  '42501', null, 'FR-SAL-01: technicians cannot add customers until the owner allows it');
reset role;

select pg_temp.login((select owner from ids), (select tenant from ids));
update public.tenants set tech_sales_enabled = true, commission_flat_cents = 2500, commission_pct = 10 where id = (select tenant from ids);
reset role;

-- On: only credited to themselves -------------------------------------------------------
select pg_temp.login((select tech_user from ids), (select tenant from ids));
select throws_ok(
  format($$insert into public.customers (display_name, sold_by_technician_id) values ('Door Two', %L)$$, (select other_tech from ids)),
  '42501', null, 'FR-SAL-02: a technician cannot credit a sale to someone else');
select throws_ok(
  $$insert into public.customers (display_name) values ('Door Three')$$,
  '42501', null, 'FR-SAL-02: a technician sale always names who made it');
select lives_ok(
  format($$insert into public.customers (display_name, sold_by_technician_id) values ('Door Four', %L)$$, (select technician from ids)),
  'FR-SAL-02: a technician adds a customer credited to themselves');
select lives_ok(
  $$insert into public.properties (customer_id, address_line1, city, region, postal_code)
    select id, '12 N State St', 'Orem', 'UT', '84057' from public.customers where display_name = 'Door Four'$$,
  'and its property');
select lives_ok(
  format($$insert into public.subscriptions (customer_id, property_id, plan_id, service_type_id, start_date, rrule, price_cents, initial_price_cents, billing_mode)
    select c.id, p.id, %L, %L, date '2026-10-08', 'FREQ=MONTHLY;INTERVAL=3', 12900, 19900, 'per_service'
    from public.customers c join public.properties p on p.customer_id = c.id where c.display_name = 'Door Four'$$,
    (select plan from ids), (select service_type from ids)),
  'and its plan');
select throws_ok(
  format($$insert into public.properties (customer_id, address_line1, city, region, postal_code) values (%L, '1 A St', 'Orem', 'UT', '84057')$$, (select other_customer from ids)),
  '42501', null, 'FR-SAL-02: but not a property for someone else''s customer');
select throws_ok(
  format($$insert into public.commissions (technician_id, customer_id, basis_cents, flat_cents, pct, amount_cents) values (%L, %L, 0, 0, 0, 999999)$$,
    (select technician from ids), (select customer from ids)),
  '42501', null, 'FR-SAL-02: a technician cannot write a commission');
create temp table sale on commit drop as
select app.record_sale_commission(
  (select id from public.customers where display_name = 'Door Four'),
  (select s.id from public.subscriptions s join public.customers c on c.id = s.customer_id where c.display_name = 'Door Four')) as id;
select is(
  (select amount_cents from public.commissions where id = (select id from sale)),
  2500 + 1990,
  'FR-SAL-01: the commission is the flat amount plus the percent of the first service, computed by the server');
select is(
  app.record_sale_commission((select id from public.customers where display_name = 'Door Four')),
  (select id from sale),
  'FR-SAL-02: recording it again changes nothing');
select throws_ok(
  format($$select app.record_sale_commission(%L)$$, (select other_customer from ids)),
  '42501', null, 'FR-SAL-02: a technician cannot record a commission on another technician''s sale');
select is((select count(*)::int from public.commissions where technician_id = (select other_tech from ids)), 0,
  'FR-SAL-04: a technician sees only their own commissions');
update public.commissions set status = 'approved';
reset role;
select is((select count(*)::int from public.commissions where status <> 'pending' and tenant_id = (select tenant from ids)), 0,
  'FR-SAL-03: a technician cannot approve a commission');

-- The office decides ---------------------------------------------------------------------
select pg_temp.login((select office from ids), (select tenant from ids));
select throws_ok(
  format($$update public.commissions set amount_cents = 1 where customer_id = %L$$, (select other_customer from ids)),
  '42501', null, 'FR-SAL-03: an amount is fixed at the sale');
select throws_ok(
  format($$update public.commissions set status = 'void' where customer_id = %L$$, (select other_customer from ids)),
  '23514', null, 'FR-SAL-03: voiding says why');
update public.commissions set status = 'approved' where customer_id = (select other_customer from ids);
update public.commissions set status = 'paid' where customer_id = (select other_customer from ids);
select is(
  (select decided_by from public.commissions where customer_id = (select other_customer from ids)), (select office from ids),
  'FR-SAL-03: who decided is recorded');
select throws_ok(
  format($$update public.commissions set status = 'pending' where customer_id = %L$$, (select other_customer from ids)),
  '23514', null, 'FR-SAL-03: paid is final');
reset role;

select * from finish();
rollback;
