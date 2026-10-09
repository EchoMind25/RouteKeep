-- Outbox lease column and portal abuse limits. PRD: ENG-04, FR-POR-01.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(10);

create temp table fx on commit drop as select pg_temp.seed_tenant('o1') as a;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant from fx;
grant select on ids to anon;
insert into public.customers (tenant_id, display_name, email) select tenant, 'Link Lena', 'lena@example.com' from ids;

select has_column('public', 'outbox_events', 'locked_until', 'outbox events carry a lease');

set local role anon;
select throws_ok($$select * from app.rate_limits$$, '42501', null, 'anon cannot read the counters');
select is(app.rate_limit_hit('t:a', 600, 2), true, 'first hit is allowed');
select is(app.rate_limit_hit('t:a', 600, 2), true, 'second hit is allowed');
select is(app.rate_limit_hit('t:a', 600, 2), false, 'third hit is over the limit');
select is(app.rate_limit_hit('t:b', 600, 2), true, 'another key has its own count');

select is(app.portal_issue_token((select tenant from ids), 'nobody@example.com', repeat('x', 40), 'https://example.test'), false, 'FR-POR-01: unknown email issues nothing');
select is(app.portal_issue_token((select tenant from ids), 'Lena@Example.com', repeat('y', 40), 'https://example.test'), true, 'a known email issues a link');
reset role;
select is((select count(*)::int from public.outbox_events where topic = 'portal.sign_in' and tenant_id = (select tenant from ids)), 1, 'and queues exactly one email');
select throws_ok($$select app.rate_limit_hit('k', 0, 1)$$, '22023', null, 'a zero-length window is refused');

select * from finish();
rollback;
