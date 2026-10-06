-- CR-12: financial and compliance changes are recorded with who and what,
-- and the record itself cannot be edited.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(6);

create temp table fx on commit drop as select pg_temp.seed_tenant('a') as a;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'office')::uuid as office, (a ->> 'invoice')::uuid as invoice
from fx;
grant select on ids to authenticated;

select pg_temp.login((select office from ids), (select tenant from ids));
update public.invoices
set status = 'void', voided_at = now(), void_reason = 'Duplicate visit'
where id = (select invoice from ids);
select is((select count(*) from public.audit_log), 0::bigint, 'office staff cannot read the audit log');
reset role;

select is(
  (select actor_id from public.audit_log where row_id = (select invoice from ids) and action = 'update'),
  (select office from ids),
  'the change is attributed to the member who made it');
select is(
  (select before ->> 'status' from public.audit_log where row_id = (select invoice from ids) and action = 'update'),
  'open', 'the prior value is kept');
select is(
  (select after ->> 'status' from public.audit_log where row_id = (select invoice from ids) and action = 'update'),
  'void', 'the new value is kept');

select throws_ok(
  $$update public.audit_log set actor_id = null$$,
  '42501', null, 'audit history cannot be rewritten');
select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null, 'audit history cannot be deleted');

select * from finish();
rollback;
