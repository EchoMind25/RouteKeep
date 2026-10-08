-- CR-10: automated cross-tenant read and write test for every table.
-- Two tenants get a full fixture; tenant A's owner must see all of A and none
-- of B, and must be unable to change or create anything in B.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select no_plan();

create temp table fx on commit drop as
select pg_temp.seed_tenant('a') as a, pg_temp.seed_tenant('b') as b;

-- A copy of one B row per table (fresh id) for the insert test.
create temp table b_rows (table_name text primary key, row_data jsonb) on commit drop;
do $$
declare
  t text;
  r jsonb;
  v_b uuid := (select (b ->> 'tenant')::uuid from fx);
begin
  for t in select * from pg_temp.tenant_tables() loop
    execute format('select to_jsonb(x) from public.%I x where %I = $1 limit 1', t, pg_temp.tenant_col(t))
      into r using v_b;
    insert into b_rows values (t, r || jsonb_build_object('id', gen_random_uuid()));
  end loop;
end
$$;
grant select on fx, b_rows to authenticated;

select isnt(row_data, null, format('%s: fixture has a row (add one to seed_tenant)', table_name))
from b_rows;

select pg_temp.login((select (a ->> 'owner')::uuid from fx), (select (a ->> 'tenant')::uuid from fx));

-- Portal sign-in tokens are read by no member at all, only by the functions
-- that issue and redeem them (008-portal).
select cmp_ok(
  pg_temp.count_rows(t, (select (a ->> 'tenant')::uuid from fx)), '>', 0::bigint,
  format('%s: owner of A sees A''s rows (control)', t))
from pg_temp.tenant_tables() t
where t <> 'portal_tokens';
select is(pg_temp.count_rows('portal_tokens', (select (a ->> 'tenant')::uuid from fx)), -1::bigint, 'portal_tokens: no member can read sign-in tokens');

select ok(
  pg_temp.count_rows(t, (select (b ->> 'tenant')::uuid from fx)) in (0, -1),
  format('%s: A reads none of B''s rows', t))
from pg_temp.tenant_tables() t;

select ok(
  pg_temp.try_update(t, (select (b ->> 'tenant')::uuid from fx)) in ('rows=0', 'denied'),
  format('%s: A cannot update B''s rows', t))
from pg_temp.tenant_tables() t;

select ok(
  pg_temp.try_delete(t, (select (b ->> 'tenant')::uuid from fx)) in ('rows=0', 'denied'),
  format('%s: A cannot delete B''s rows', t))
from pg_temp.tenant_tables() t;

select is(
  pg_temp.try_insert(table_name, row_data), 'denied',
  format('%s: A cannot insert a row into B', table_name))
from b_rows;

-- Composite foreign keys: a row in A can never point at a row in B, even
-- though foreign key checks bypass RLS.
select throws_ok(
  format($$insert into public.properties (customer_id, address_line1, city, region, postal_code)
           values (%L, '9 Canyon Rd', 'Provo', 'UT', '84604')$$, (select b ->> 'customer' from fx)),
  '23503', null, 'A cannot attach a property to B''s customer');

select throws_ok(
  format($$insert into public.appointments (customer_id, property_id, service_type_id, local_date, tz)
           values (%L, %L, %L, date '2026-10-07', 'America/Denver')$$,
         (select b ->> 'customer' from fx), (select b ->> 'property' from fx), (select a ->> 'service_type' from fx)),
  '23503', null, 'A cannot schedule a visit at B''s property');

select throws_ok(
  format($$insert into public.payments (customer_id, invoice_id, client_payment_key, method, status, amount_cents, received_at)
           values (%L, %L, 'cross-tenant-0001', 'cash', 'succeeded', 100, now())$$,
         (select a ->> 'customer' from fx), (select b ->> 'invoice' from fx)),
  '23503', null, 'A cannot apply a payment to B''s invoice');

select throws_ok(
  format($$insert into public.applications (appointment_id, client_key, imported) values (%L, 'cross-tenant-app', true)$$,
         (select b ->> 'appointment' from fx)),
  '23503', null, 'A cannot write an application record against B''s visit');

select throws_ok(
  format($$insert into public.subscriptions (customer_id, property_id, plan_id, service_type_id, start_date, rrule, price_cents, billing_mode)
           values (%L, %L, %L, %L, date '2026-11-01', 'FREQ=MONTHLY', 100, 'monthly')$$,
         (select a ->> 'customer' from fx), (select a ->> 'property' from fx),
         (select b ->> 'plan' from fx), (select a ->> 'service_type' from fx)),
  '23503', null, 'A cannot sell B''s plan');

reset role;

-- A token naming a tenant the user does not belong to grants nothing.
select pg_temp.login((select (a ->> 'owner')::uuid from fx), (select (b ->> 'tenant')::uuid from fx));
select is(
  (select count(*) from public.customers), 0::bigint,
  'a tenant claim without a membership sees no rows');
reset role;

-- Revoking a member takes effect on their next query, not at token expiry.
update public.memberships set deactivated_at = now()
where user_id = (select (a ->> 'office')::uuid from fx);
select pg_temp.login((select (a ->> 'office')::uuid from fx), (select (a ->> 'tenant')::uuid from fx));
select is(
  (select count(*) from public.customers), 0::bigint,
  'a deactivated member sees no rows');
reset role;

set local role anon;
select throws_ok('select count(*) from public.customers', '42501', null, 'anon cannot read tenant tables');
select throws_ok('select count(*) from public.customer_balances', '42501', null, 'anon cannot read report views');
reset role;

select * from finish();
rollback;
