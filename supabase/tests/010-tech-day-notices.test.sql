-- "Running late" notices (FR-TEC-02, FR-DSP-05, ENG-01): a technician adds one,
-- every member reads their own business's, nobody rewrites one, a retry is stored once.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(8);

create temp table fx on commit drop as select pg_temp.seed_tenant('late1') as a, pg_temp.seed_tenant('late2') as b;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'tech_user')::uuid as tech_user, (a ->> 'technician')::uuid as technician,
       (a ->> 'dispatcher')::uuid as dispatcher, (b ->> 'technician')::uuid as other_technician
from fx;
grant select on ids to authenticated;

select pg_temp.login((select tech_user from ids), (select tenant from ids));
select lives_ok(
  $$insert into public.tech_day_notices (technician_id, local_date, kind, delay_min, client_key)
    values ((select technician from ids), date '2026-10-09', 'running_late', 45, 'late-key-0001')$$,
  'a technician adds a running late notice');
select throws_ok(
  $$insert into public.tech_day_notices (technician_id, local_date, kind, delay_min, client_key)
    values ((select technician from ids), date '2026-10-09', 'running_late', 45, 'late-key-0001')$$,
  '23505', null, 'ENG-01: the same client key is stored once');
select throws_ok(
  $$insert into public.tech_day_notices (technician_id, local_date, kind, delay_min, client_key)
    values ((select other_technician from ids), date '2026-10-09', 'running_late', 15, 'late-key-0002')$$,
  '23503', null, 'DB-02: a notice cannot name another business''s technician');
select throws_ok(
  $$insert into public.tech_day_notices (technician_id, local_date, kind, delay_min, client_key)
    values ((select technician from ids), date '2026-10-09', 'running_late', 0, 'late-key-0003')$$,
  '23514', null, 'a delay of zero is not a notice');
select throws_ok($$update public.tech_day_notices set delay_min = 5$$, '42501', null, 'a notice is never rewritten');
reset role;

select pg_temp.login((select dispatcher from ids), (select tenant from ids));
select is((select count(*)::int from public.tech_day_notices), 2, 'the office sees this business''s notices (seed plus the new one)');
select is((select max(delay_min) from public.tech_day_notices where local_date = date '2026-10-09'), 45, 'and the delay');
reset role;

select pg_temp.login((select tech_user from ids), (select tenant from ids));
select throws_ok($$delete from public.tech_day_notices$$, '42501', null, 'nobody deletes a notice');
reset role;

select * from finish();
rollback;
