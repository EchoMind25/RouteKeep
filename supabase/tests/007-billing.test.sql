-- M4 stage 1: who may bill, and what stays fixed (FR-BIL-01, FR-BIL-06, ENG-06).
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(10);

create temp table fx on commit drop as select pg_temp.seed_tenant('b') as b;
create temp table ids on commit drop as
select (b ->> 'tenant')::uuid as tenant, (b ->> 'office')::uuid as office, (b ->> 'dispatcher')::uuid as dispatcher,
       (b ->> 'tech_user')::uuid as tech_user, (b ->> 'customer')::uuid as customer
from fx;
grant select on ids to authenticated;

select pg_temp.login((select office from ids), (select tenant from ids));
create temp table inv on commit drop as select gen_random_uuid() as id;
grant select on inv to authenticated;
select lives_ok(
  format($$insert into public.invoices (id, customer_id, period_key, status, total_cents, issued_at, due_date)
           values (%L, %L, 'test-1', 'open', 5000, now(), current_date);
           insert into public.invoice_lines (invoice_id, description, unit_amount_cents, amount_cents) values (%L, 'General pest', 5000, 5000);
           insert into public.ledger_entries (customer_id, type, amount_cents, invoice_id, entry_key) values (%L, 'invoice', 5000, %L, 'invoice:test-1')$$,
    (select id from inv), (select customer from ids), (select id from inv), (select customer from ids), (select id from inv)),
  'FR-BIL-01: the office issues an invoice with its lines and ledger entry');
-- Deferred checks only run at commit, and tests roll back: run them now.
select lives_ok($$set constraints all immediate$$, 'and the invoice total check passes as the office');
select throws_ok(
  format($$update public.invoice_lines set amount_cents = 1, unit_amount_cents = 1 where invoice_id = %L$$, (select id from inv)),
  '42501', null, 'FR-BIL-06: lines are fixed once the invoice is issued');
select throws_ok(
  $$update public.ledger_entries set amount_cents = 1 where entry_key = 'invoice:test-1'$$,
  '42501', null, 'ENG-06: the ledger is append-only, even for the office');
update public.invoices set status = 'void', voided_at = now(), void_reason = 'test' where id = (select id from inv);
select throws_ok(
  format($$update public.invoices set status = 'open' where id = %L$$, (select id from inv)),
  '23514', null, 'a void invoice stays void');
select is((select count(*)::int from public.billing_runs), 1, 'the office sees billing runs');
reset role;

select pg_temp.login((select dispatcher from ids), (select tenant from ids));
select throws_ok(
  format($$insert into public.invoices (customer_id, period_key, status, total_cents) values (%L, 'test-2', 'open', 0)$$, (select customer from ids)),
  '42501', null, 'dispatchers do not invoice');
select is((select count(*)::int from public.billing_runs), 0, 'dispatchers do not see billing runs');
reset role;

select pg_temp.login((select tech_user from ids), (select tenant from ids));
select throws_ok(
  format($$insert into public.ledger_entries (customer_id, type, amount_cents, entry_key) values (%L, 'opening_balance', 100, 'tech-1')$$, (select customer from ids)),
  '42501', null, 'technicians do not write the ledger');
select throws_ok(
  format($$insert into public.payments (customer_id, client_payment_key, method, status, amount_cents) values (%L, 'tech-card-1', 'card', 'succeeded', 100)$$, (select customer from ids)),
  '42501', null, 'CR-05: nobody but Stripe marks a card payment paid');
reset role;

select * from finish();
rollback;
