-- ENG-01, FR-MIG-12, FR-MIG-14: a retried new-customer form cannot create a
-- second customer; a failed import row can be marked; messages can be detached.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(6);

create temp table fx on commit drop as select pg_temp.seed_tenant('idem1') as a;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'owner')::uuid as owner from fx;
grant select on ids to authenticated;

select pg_temp.login((select owner from ids), (select tenant from ids));
insert into public.customers (display_name, client_key) values ('Retry Test', 'form-1');
select throws_ok(
  $$insert into public.customers (display_name, client_key) values ('Retry Test again', 'form-1')$$,
  '23505', null, 'ENG-01: the same form key cannot create a second customer');
select lives_ok(
  $$insert into public.customers (display_name, client_key) values ('Retry Test', 'form-1') on conflict (tenant_id, client_key) do nothing$$,
  'ENG-01: the retry path does nothing instead of failing');
select is((select count(*)::int from public.customers where client_key = 'form-1'), 1, 'ENG-01: one customer for the key');
select lives_ok(
  $$insert into public.customers (display_name) values ('No key one'), ('No key two')$$,
  'customers without a key (older rows, imports) are unrestricted');
reset role;

select lives_ok(
  $$update public.import_rows set status = 'error', reasons = array['This row could not be imported.'] where tenant_id = (select tenant from ids)$$,
  'FR-MIG-12: a row can be marked as an error');

-- FR-MIG-14: the rollback detaches messages from customers it removes.
select lives_ok(
  $$update public.messages set customer_id = null, appointment_id = null where tenant_id = (select tenant from ids)$$,
  'FR-MIG-14: messages can be detached and kept');

select * from finish();
rollback;
