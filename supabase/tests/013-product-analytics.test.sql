-- Product analytics: every event passes the per-business data-sharing gate,
-- lowering the level reaches past rows, and only the developer console's ops
-- functions read the events back. Opt-in: every business starts at none.
-- PRD: OPS-03, OPS-04. Contract: docs/DATA_COLLECTION.md.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select no_plan();

create temp table fx on commit drop as
select pg_temp.seed_tenant('pa1') as a, pg_temp.seed_tenant('pa2') as b;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as t1, (a ->> 'owner')::uuid as owner1, (a ->> 'admin')::uuid as admin1,
       (a ->> 'office')::uuid as office1, (a ->> 'dispatcher')::uuid as dispatch1, (a ->> 'tech_user')::uuid as tech1,
       (b ->> 'tenant')::uuid as t2, (b ->> 'owner')::uuid as owner2
from fx;
grant select on ids to authenticated, anon, portal, platform_operator;
-- Test-only: pgTAP lives in extensions, which these roles do not otherwise need.
grant usage on schema extensions to anon, portal, platform_operator;

-- Privileges -----------------------------------------------------------------------

select ok(not has_table_privilege(r, 'app.product_events', p), format('%s has no %s on app.product_events', r, p))
from unnest(array['anon', 'authenticated', 'portal', 'platform_operator']) r
cross join unnest(array['select', 'insert', 'update', 'delete']) p;

select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot call %s', r, f))
from unnest(array['anon', 'authenticated', 'portal']) r
cross join unnest(array['app.ops_product_summary(integer)', 'app.ops_product_errors(integer,integer)', 'app.purge_product_events(integer,integer)']) f;

select ok(has_function_privilege('platform_operator', f, 'execute'), format('platform_operator can call %s', f))
from unnest(array['app.ops_product_summary(integer)', 'app.ops_product_errors(integer,integer)']) f;
select ok(not has_function_privilege('platform_operator', 'app.purge_product_events(integer,integer)', 'execute'), 'platform_operator cannot purge');

-- Opt-in: nothing until a level is chosen ---------------------------------------------

select results_eq(
  $$select data_sharing, data_sharing_changed_at is null from public.tenants where id = (select t1 from ids)$$,
  $$values ('none'::text, true)$$,
  'a new business starts at none, not answered');
select pg_temp.login((select tech1 from ids), (select t1 from ids));
select is(app.track_event('error.client', '{"kind":"crash","fingerprint":"pa-fp-0"}', 'tech', 'pa-test-0'), false, 'a new business stores no error report');
select is(app.track_event('route.proposal_shown', '{"engine":"solver","stops":3}', 'office', 'pa-test-0'), false, 'or product event');
reset role;
select is((select count(*)::int from app.product_events where app_version = 'pa-test-0'), 0, 'nothing is stored until a level is chosen');

-- Choosing none on purpose records the answer.
select pg_temp.login((select owner2 from ids), (select t2 from ids));
update public.tenants set data_sharing = 'none' where id = (select t2 from ids);
reset role;
select results_eq(
  $$select data_sharing, data_sharing_changed_at is not null from public.tenants where id = (select t2 from ids)$$,
  $$values ('none'::text, true)$$,
  'answering none marks the question answered');

-- Anonymous: stored without the business ----------------------------------------------

select pg_temp.login((select owner1 from ids), (select t1 from ids));
update public.tenants set data_sharing = 'anonymous' where id = (select t1 from ids);
reset role;

select pg_temp.login((select tech1 from ids), (select t1 from ids));
select ok(app.track_event('route.stop_out_of_order', '{"published_position":2,"actual_position":5,"stops":9}', 'tech', 'pa-test'), 'a member event is stored');
select throws_ok($$select count(*) from app.product_events$$, '42501', null, 'a member cannot read the events');
select throws_ok($$insert into app.product_events (hour, name, surface) values (now(), 'route.proposal_shown', 'office')$$, '42501', null, 'or insert around the gate');
select throws_ok($$select app.track_event('route.proposal_shown', '{"engine":{"nested":1}}', 'office')$$, '22023', null, 'nested props are refused');
select throws_ok($$select app.track_event('route.proposal_shown', '{"engine":[1,2]}', 'office')$$, '22023', null, 'array props are refused');
select throws_ok(format($$select app.track_event('route.proposal_shown', '{"engine":"%s"}', 'office')$$, repeat('x', 201)), '22023', null, 'long string props are refused');
select throws_ok(
  format($$select app.track_event('route.proposal_shown', %L::jsonb, 'office')$$, (select jsonb_object_agg('k' || i, repeat('y', 150)) from generate_series(1, 20) i)),
  '22023', null, 'props over 2 KB are refused');
select throws_ok($$select app.track_event('Not A Name', '{}', 'office')$$, '23514', null, 'malformed event names are refused');
select throws_ok($$select app.track_event('route.proposal_shown', '{}', 'elsewhere')$$, '23514', null, 'unknown surfaces are refused');
reset role;

select results_eq(
  $$select tenant_id, surface, hour = date_trunc('hour', hour) from app.product_events where app_version = 'pa-test'$$,
  $$values (null::uuid, 'tech'::text, true)$$,
  'stored with no business id, on the hour');

-- Identified: stored with the business ------------------------------------------------

-- Roles below owner/admin cannot change the setting.
create temp table attempts (who text, rows int) on commit drop;
grant insert on attempts to authenticated;
select pg_temp.login((select office1 from ids), (select t1 from ids));
with u as (update public.tenants set data_sharing = 'identified' where id = (select t1 from ids) returning 1)
insert into attempts select 'office', count(*) from u;
reset role;
select pg_temp.login((select dispatch1 from ids), (select t1 from ids));
with u as (update public.tenants set data_sharing = 'identified' where id = (select t1 from ids) returning 1)
insert into attempts select 'dispatcher', count(*) from u;
reset role;
select pg_temp.login((select tech1 from ids), (select t1 from ids));
with u as (update public.tenants set data_sharing = 'identified' where id = (select t1 from ids) returning 1)
insert into attempts select 'technician', count(*) from u;
reset role;
select is(rows, 0, format('%s cannot change data sharing', who)) from attempts;
select is((select data_sharing from public.tenants where id = (select t1 from ids)), 'anonymous', 'the setting is unchanged');

-- Admin can; owner of another business cannot touch this one.
select pg_temp.login((select owner2 from ids), (select t2 from ids));
with u as (update public.tenants set data_sharing = 'none' where id = (select t1 from ids) returning 1)
insert into attempts select 'other owner', count(*) from u;
reset role;
select is((select rows from attempts where who = 'other owner'), 0, 'another business''s owner cannot change it');
select is((select data_sharing from public.tenants where id = (select t1 from ids)), 'anonymous', 'still anonymous');

select pg_temp.login((select admin1 from ids), (select t1 from ids));
select lives_ok($$update public.tenants set data_sharing = 'identified' where id = (select t1 from ids)$$, 'an admin can change it');
reset role;
select is((select data_sharing from public.tenants where id = (select t1 from ids)), 'identified', 'now identified');
select ok((select data_sharing_changed_at from public.tenants where id = (select t1 from ids)) is not null, 'the change time is recorded');

select pg_temp.login((select tech1 from ids), (select t1 from ids));
select ok(app.track_event('error.client', '{"kind":"crash","fingerprint":"pa-fp-1","message":"x is undefined","route":"/today"}', 'tech', 'pa-test-2'), 'identified event stored');
select ok(app.track_event('route.proposal_accepted', '{"engine":"solver","stops":9}', 'office', 'pa-test-2'), 'and another');
reset role;
select is(
  (select count(*)::int from app.product_events where app_version = 'pa-test-2' and tenant_id = (select t1 from ids)),
  2, 'identified events carry the business id');

-- The other business shares anonymously and sends the same error.
select pg_temp.login((select owner2 from ids), (select t2 from ids));
update public.tenants set data_sharing = 'anonymous' where id = (select t2 from ids);
select ok(app.track_event('error.client', '{"kind":"crash","fingerprint":"pa-fp-1","message":"x is undefined","route":"/today"}', 'tech', 'pa-test-2'), 'anonymous business error stored');
reset role;

-- The console, as the operator.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"platform_operator","email":"dev@example.com"}', true);
set local role platform_operator;
select throws_ok($$select count(*) from app.product_events$$, '42501', null, 'the operator cannot read events directly');
select results_eq(
  $$select occurrences, businesses from app.ops_product_errors(7, 50) where fingerprint = 'pa-fp-1'$$,
  $$values (2, array['Tenant pa1']::text[])$$,
  'errors are grouped, with names only for identified businesses');
select ok((app.ops_product_summary(30) -> 'sharing' ->> 'identified')::int >= 1, 'the summary counts identified businesses');
select ok((app.ops_product_summary(30) -> 'routes' -> 'solver' ->> 'accepted')::int >= 1, 'the summary counts accepted routes per engine');
select ok((app.ops_product_summary(30) -> 'out_of_order' ->> 'stops')::int >= 1, 'and out-of-order stops');
select ok(exists (select 1 from jsonb_array_elements(app.ops_product_summary(30) -> 'identified') e where e ->> 'name' = 'Tenant pa1'), 'the identified list names the sharing business');
select ok(not exists (select 1 from jsonb_array_elements(app.ops_product_summary(30) -> 'identified') e where e ->> 'name' = 'Tenant pa2'), 'and not the anonymous one');
reset role;

-- Lowering the level reaches past rows ------------------------------------------------

select pg_temp.login((select owner1 from ids), (select t1 from ids));
update public.tenants set data_sharing = 'anonymous' where id = (select t1 from ids);
reset role;
select is((select count(*)::int from app.product_events where tenant_id = (select t1 from ids)), 0, 'identified to anonymous removes the business id');
select is((select count(*)::int from app.product_events where app_version = 'pa-test-2'), 3, 'and keeps the events');

select pg_temp.login((select owner1 from ids), (select t1 from ids));
update public.tenants set data_sharing = 'identified' where id = (select t1 from ids);
select ok(app.track_event('route.proposal_dismissed', '{"engine":"ai","stops":4}', 'office', 'pa-test-3'), 'identified again');
update public.tenants set data_sharing = 'none' where id = (select t1 from ids);
select is(app.track_event('error.client', '{"kind":"crash","fingerprint":"pa-fp-2"}', 'office', 'pa-test-3'), false, 'at none nothing is stored, and the gate says so');
select is(app.track_event('route.proposal_shown', '{"engine":"ai"}', 'office', 'pa-test-3'), false, 'for any event');
reset role;
select is((select count(*)::int from app.product_events where tenant_id = (select t1 from ids)), 0, 'identified to none deletes the business''s rows');
select is((select count(*)::int from app.product_events where app_version = 'pa-test-3'), 0, 'nothing from pa-test-3 remains');

-- Signed out and portal ----------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(app.track_event('route.proposal_shown', '{"engine":"ai"}', 'public', 'pa-anon'), false, 'anon cannot store product events');
select ok(app.track_event('error.client', '{"kind":"crash","fingerprint":"pa-fp-3"}', 'public', 'pa-anon'), 'anon can store an error report');
select throws_ok($$select count(*) from app.product_events$$, '42501', null, 'anon cannot read events');
reset role;
select results_eq($$select tenant_id, name from app.product_events where app_version = 'pa-anon'$$, $$values (null::uuid, 'error.client'::text)$$, 'the public error has no business');

select set_config('request.jwt.claims', jsonb_build_object('role', 'portal', 'portal_tenant_id', (select t1 from ids))::text, true);
set local role portal;
select is(app.track_event('error.client', '{"kind":"crash"}', 'portal', 'pa-portal'), false, 'the portal of a business at none stores nothing');
select throws_ok($$select count(*) from app.product_events$$, '42501', null, 'the portal cannot read events');
reset role;

-- Retention ------------------------------------------------------------------------------

insert into app.product_events (hour, name, surface, app_version) values
  (date_trunc('hour', now()) - interval '200 days', 'error.server', 'server', 'pa-old'),
  (date_trunc('hour', now()) - interval '10 days', 'error.server', 'server', 'pa-recent');
select ok(app.purge_product_events(180) >= 1, 'purge deletes something');
select is((select count(*)::int from app.product_events where app_version = 'pa-old'), 0, 'rows older than the window are gone');
select is((select count(*)::int from app.product_events where app_version = 'pa-recent'), 1, 'recent rows stay');

select * from finish();
rollback;
