-- Outbox priority lane. PRD: ENG-04, FR-MSG-01.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(5);

create temp table fx on commit drop as select pg_temp.seed_tenant('op') as a;
create temp table ids on commit drop as select (a ->> 'tenant')::uuid as tenant from fx;

select col_default_is('public', 'outbox_events', 'priority', '1', 'bulk mail is priority 1 by default');

insert into public.outbox_events (tenant_id, event_id, channel, topic)
select tenant, gen_random_uuid(), 'email', t
from ids, unnest(array['appointment.reminder', 'appointment.on_the_way', 'appointment.completed', 'portal.sign_in', 'payment.received', 'payment.failed', 'invoice.issued']) t;

select results_eq(
  $$select distinct topic from public.outbox_events where priority = 0 and tenant_id = (select tenant from ids) order by topic$$,
  $$values ('appointment.completed'), ('appointment.on_the_way'), ('payment.failed'), ('payment.received'), ('portal.sign_in')$$,
  'FR-MSG-01: time-sensitive topics are priority 0');
select results_eq(
  $$select distinct topic from public.outbox_events where priority = 1 and tenant_id = (select tenant from ids) order by topic$$,
  $$values ('appointment.reminder'), ('invoice.issued')$$,
  'everything else is priority 1');

-- An older reminder must not go ahead of a newer priority 0 event.
update public.outbox_events set available_at = now() - interval '2 hours' where topic = 'appointment.reminder';
select isnt((select topic from public.outbox_events where sent_at is null order by priority, available_at limit 1), 'appointment.reminder', 'ENG-04: priority orders the claim before available_at');

select ok((select indexdef like '%(priority, available_at)%' from pg_indexes where indexname = 'outbox_pending'), 'outbox_pending matches the claim order');

select * from finish();
rollback;
