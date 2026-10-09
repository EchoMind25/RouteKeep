-- Developer console: the platform_operator role reads counts through the ops
-- functions only, and every action lands in an append-only audit. PRD: OPS-01, OPS-02.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select no_plan();

create temp table fx on commit drop as select pg_temp.seed_tenant('op1') as a;
create temp table ids on commit drop as select (a ->> 'tenant')::uuid as tenant from fx;
grant select on ids to platform_operator;
-- Test-only: pgTAP lives in extensions, which the role itself does not need.
grant usage on schema extensions to platform_operator;
insert into public.customers (tenant_id, display_name, email) select tenant, 'Private Pat', 'pat@example.com' from ids;
insert into public.messages (tenant_id, channel, template, recipient, status, error)
select tenant, 'email', 'reminder', 'pat@example.com', 'failed', 'Rejected recipient pat@example.com' from ids;
insert into public.webhook_events (tenant_id, provider, event_id, type, payload, error)
select tenant, 'stripe', 'evt_ops_console', 'payment_intent.succeeded', '{}'::jsonb, 'no matching payment' from ids;

create temp table counts on commit drop as
select count(*)::int as active from public.customers where tenant_id = (select tenant from ids) and status = 'active';
grant select on counts to platform_operator;

-- No table privileges: a bug in the console cannot read customer rows.
select ok(
  not has_table_privilege('platform_operator', c.oid, p),
  format('%s: platform_operator has no %s privilege', c.relname, p)
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join unnest(array['select', 'insert', 'update', 'delete']) p
where n.nspname = 'public' and c.relkind in ('r', 'v');

select ok(not has_table_privilege(r, 'app.operator_audit', 'select'), format('%s cannot read the operator audit directly', r))
from unnest(array['anon', 'authenticated', 'portal', 'platform_operator']) r;

select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot call %s', r, f))
from unnest(array['anon', 'authenticated', 'portal']) r
cross join unnest(array['app.ops_tenants()', 'app.ops_health()', 'app.ops_recent_errors(integer)', 'app.ops_audit_recent(integer)', 'app.ops_record(text,uuid,jsonb)']) f;

-- As the operator.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"platform_operator","email":"Dev@Example.com"}', true);
set local role platform_operator;

select throws_ok($$select count(*) from public.customers$$, '42501', null, 'the operator cannot select customers');
select throws_ok($$select count(*) from public.messages$$, '42501', null, 'or messages');

select is(
  (select active_customers from app.ops_tenants() where tenant_id = (select tenant from ids)),
  (select active from counts), 'ops_tenants counts active customers per business');
select ok((app.ops_health() ->> 'tenants')::int >= 1, 'ops_health counts businesses');
select ok(app.ops_health() ? 'outbox' and app.ops_health() ? 'payments' and app.ops_health() ? 'webhooks', 'ops_health covers queues, payments and webhooks');

select is(
  (select count(*)::int from app.ops_recent_errors(50) where source = 'webhook' and tenant_id = (select tenant from ids)),
  1, 'recent errors include webhook failures');
select is(
  (select count(*)::int from app.ops_recent_errors(50) where error like '%pat@example.com%'),
  0, 'recent errors never carry a customer message error (it can quote the address)');

select lives_ok($$select app.ops_record('dashboard.view', null, '{"section":"all"}'::jsonb)$$, 'an action is recorded');
select results_eq(
  $$select actor_email, action from app.ops_audit_recent(1)$$,
  $$values ('dev@example.com'::text, 'dashboard.view'::text)$$,
  'the actor comes from the claims, lower-cased');
select throws_ok($$select app.ops_record('Bad Action')$$, '23514', null, 'action names are checked');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"platform_operator"}', true);
select throws_ok($$select app.ops_record('dashboard.view')$$, '42501', null, 'an action without an email identity is refused');
reset role;

select throws_ok($$update app.operator_audit set action = 'changed.it'$$, '42501', null, 'audit rows cannot be edited');
select throws_ok($$delete from app.operator_audit$$, '42501', null, 'or deleted');

select * from finish();
rollback;
