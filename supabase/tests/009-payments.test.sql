-- M4 stage 2: saved payment methods and reconciliation findings (FR-BIL-02,
-- FR-BIL-07, CR-05, CR-06). Only server code holding Stripe's answer writes
-- them; members read what their role allows; the portal sees its own method.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(14);

create temp table fx on commit drop as select pg_temp.seed_tenant('pay1') as a, pg_temp.seed_tenant('pay2') as b;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'customer')::uuid as customer, (a ->> 'owner')::uuid as owner,
       (a ->> 'office')::uuid as office, (a ->> 'dispatcher')::uuid as dispatcher, (a ->> 'payment')::uuid as payment,
       (b ->> 'tenant')::uuid as other_tenant
from fx;
grant select on ids to portal, authenticated;

-- Members ----------------------------------------------------------------------------
select pg_temp.login((select office from ids), (select tenant from ids));
select is((select count(*)::int from public.payment_methods), 1, 'the office sees its own customers'' saved methods');
select throws_ok(
  $$insert into public.payment_methods (customer_id, stripe_payment_method_id, kind, label, consent_text, consented_at)
    select customer, 'pm_forged', 'card', 'Visa ending 0000', 'I allow this business to charge this card.', now() from ids$$,
  '42501', null, 'no member writes a saved method: only Stripe''s answer does');
select is((select count(*)::int from public.reconciliation_issues), 0, 'the office does not see reconciliation findings');
select throws_ok($$update public.payments set status = 'succeeded' where id = (select payment from ids)$$, '42501', null, 'no member marks a payment paid');
reset role;

select pg_temp.login((select dispatcher from ids), (select tenant from ids));
select is((select count(*)::int from public.payment_methods), 0, 'a dispatcher sees no payment methods');
reset role;

select pg_temp.login((select owner from ids), (select tenant from ids));
select is((select count(*)::int from public.reconciliation_issues), 1, 'the owner sees this business''s findings only');
select lives_ok($$update public.reconciliation_issues set resolved_at = now(), resolved_by = (select owner from ids)$$, 'the owner can mark a finding sorted');
select throws_ok($$update public.reconciliation_issues set details = 'rewritten'$$, '42501', null, '... but not rewrite what was found');
select throws_ok($$update public.tenants set stripe_charges_enabled = true$$, '42501', null, 'no member switches card payments on; Stripe''s answer does');
reset role;

-- Database rules -----------------------------------------------------------------------
select throws_ok(
  $$insert into public.payment_methods (tenant_id, customer_id, stripe_payment_method_id, kind, label, consent_text, consented_at)
    select tenant, customer, 'pm_second', 'card', 'Visa ending 1111', 'I allow this business to charge this card.', now() from ids$$,
  '23505', null, 'one active method per customer');
select throws_ok(
  $$insert into public.payment_methods (tenant_id, customer_id, stripe_payment_method_id, kind, label, consent_text, consented_at, status)
    select tenant, customer, 'pm_bank', 'us_bank_account', 'Bank ending 6789', 'I allow this business to debit this account.', now(), 'revoked' from ids$$,
  '23514', null, 'a bank method needs its mandate (CR-06), and a revoked one its date');

-- The portal -------------------------------------------------------------------------
select set_config('request.jwt.claims', jsonb_build_object('role', 'portal', 'portal_tenant_id', (select tenant from ids), 'portal_customer_id', (select customer from ids))::text, true);
set local role portal;
select is((select label from public.payment_methods), 'Visa ending 4242', 'the customer sees their own saved method');
select is((select count(*)::int from public.payment_methods where tenant_id = (select other_tenant from ids)), 0, '... and nobody else''s');
select throws_ok($$select * from public.reconciliation_issues$$, '42501', null, 'the portal never sees reconciliation findings');
reset role;

select * from finish();
rollback;
