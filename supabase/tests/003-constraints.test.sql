-- Database-enforced invariants: DB-01..DB-08, CR-01, FR-REC-03, FR-REC-05,
-- ENG-05 (IANA zones), ENG-06 (ledger), ENG-07 (version), R-BUG-05 (locked pins).
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(43);

create temp table fx on commit drop as
select pg_temp.seed_tenant('a') as a, pg_temp.seed_tenant('b') as b;
grant select on fx to authenticated;

create temp table ids on commit drop as
select
  (a ->> 'tenant')::uuid as tenant,
  (a ->> 'customer')::uuid as customer,
  (a ->> 'property')::uuid as property,
  (a ->> 'subscription')::uuid as subscription,
  (a ->> 'appointment')::uuid as appointment,
  (a ->> 'service_type')::uuid as service_type,
  (a ->> 'technician')::uuid as technician,
  (a ->> 'product')::uuid as product,
  (a ->> 'invoice')::uuid as invoice,
  (a ->> 'payment')::uuid as payment,
  (a ->> 'application')::uuid as application,
  (a ->> 'tech_user')::uuid as tech_user,
  (a ->> 'owner')::uuid as owner,
  (b ->> 'tenant')::uuid as tenant_b,
  (b ->> 'customer')::uuid as customer_b
from fx;
grant select on ids to authenticated;

-- DB-01 -----------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.payments (tenant_id, customer_id, client_payment_key, method, status, amount_cents, received_at)
           values (%L, %L, 'pay-a-000001', 'cash', 'succeeded', 500, now())$$,
         (select tenant from ids), (select customer from ids)),
  '23505', null, 'DB-01: a client payment key is accepted once per tenant');
select lives_ok(
  format($$insert into public.payments (tenant_id, customer_id, client_payment_key, method, status, amount_cents, received_at)
           values (%L, %L, 'pay-a-000001', 'cash', 'succeeded', 500, now())$$,
         (select tenant_b from ids), (select customer_b from ids)),
  'DB-01: the same key in another tenant is a different payment');

-- DB-02 -----------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.invoices (tenant_id, customer_id, subscription_id, period_key, total_cents)
           values (%L, %L, %L, '2026-10-05', 0)$$,
         (select tenant from ids), (select customer from ids), (select subscription from ids)),
  '23505', null, 'DB-02: one invoice per subscription period');

-- DB-03 -----------------------------------------------------------------------------
select throws_ok(
  $$insert into public.webhook_events (provider, event_id, type, payload) values ('stripe', 'evt_a', 'x', '{}')$$,
  '23505', null, 'DB-03: a provider event id is stored once');

-- DB-04 -----------------------------------------------------------------------------
select lives_ok(
  format($$insert into public.outbox_events (tenant_id, event_id, channel, topic)
           values (%L, '6f1c2a52-6d9f-4d55-9a3e-6a4f0f1e2a10', 'email', 'invoice.issued'),
                  (%L, '6f1c2a52-6d9f-4d55-9a3e-6a4f0f1e2a10', 'sms', 'invoice.issued')$$,
         (select tenant from ids), (select tenant from ids)),
  'DB-04: one event may fan out to several channels');
select throws_ok(
  format($$insert into public.outbox_events (tenant_id, event_id, channel, topic)
           values (%L, '6f1c2a52-6d9f-4d55-9a3e-6a4f0f1e2a10', 'email', 'invoice.issued')$$,
         (select tenant from ids)),
  '23505', null, 'DB-04: but each event is sent once per channel');

-- DB-05 -----------------------------------------------------------------------------
select lives_ok(
  format($$insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, local_date, tz, client_key)
           values (%L, %L, %L, %L, date '2026-10-09', 'America/Denver', 'offline-visit-7')$$,
         (select tenant from ids), (select customer from ids), (select property from ids), (select service_type from ids)),
  'DB-05: an offline-created visit is accepted');
select throws_ok(
  format($$insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, local_date, tz, client_key)
           values (%L, %L, %L, %L, date '2026-10-09', 'America/Denver', 'offline-visit-7')$$,
         (select tenant from ids), (select customer from ids), (select property from ids), (select service_type from ids)),
  '23505', null, 'DB-05: and its replay is rejected');
select throws_ok(
  format($$insert into public.applications (tenant_id, appointment_id, client_key, imported) values (%L, %L, 'app-a-1', true)$$,
         (select tenant from ids), (select appointment from ids)),
  '23505', null, 'DB-05: an application record replay is rejected');

-- FR-SUB-02: idempotent generation hinges on one row per occurrence.
select throws_ok(
  format($$insert into public.appointments (tenant_id, customer_id, property_id, subscription_id, service_type_id, local_date, tz, occurrence_date)
           values (%L, %L, %L, %L, %L, date '2026-10-06', 'America/Denver', date '2026-10-05')$$,
         (select tenant from ids), (select customer from ids), (select property from ids),
         (select subscription from ids), (select service_type from ids)),
  '23505', null, 'FR-SUB-02: one appointment per subscription occurrence, even when moved');

-- DB-06 -----------------------------------------------------------------------------
select lives_ok(
  format($$insert into public.customers (tenant_id, display_name, source, external_ref)
           values (%L, 'Imported One', 'fieldroutes', 'FR-1001')$$, (select tenant from ids)),
  'DB-06: imported customer accepted');
select throws_ok(
  format($$insert into public.customers (tenant_id, display_name, source, external_ref)
           values (%L, 'Imported One Again', 'fieldroutes', 'FR-1001')$$, (select tenant from ids)),
  '23505', null, 'DB-06: re-importing the same source row is rejected');
select lives_ok(
  format($$insert into public.customers (tenant_id, display_name) values (%L, 'Walk-in One'), (%L, 'Walk-in Two')$$,
         (select tenant from ids), (select tenant from ids)),
  'DB-06: manual customers without an external ref never collide');

-- DB-07 -----------------------------------------------------------------------------
select throws_ok(
  format($$update public.ledger_entries set memo = 'edited' where tenant_id = %L$$, (select tenant from ids)),
  '42501', null, 'DB-07: ledger rows cannot be updated, even by the owner role');
select throws_ok(
  format($$delete from public.ledger_entries where tenant_id = %L$$, (select tenant from ids)),
  '42501', null, 'DB-07: ledger rows cannot be deleted');
select throws_ok(
  format($$insert into public.ledger_entries (tenant_id, customer_id, type, amount_cents, payment_id, entry_key)
           values (%L, %L, 'payment', 500, %L, 'payment:wrong-sign')$$,
         (select tenant from ids), (select customer from ids), (select payment from ids)),
  '23514', null, 'ENG-06: a payment must reduce the balance');
select results_eq(
  format($$select balance_cents from public.customer_balances where customer_id = %L$$, (select customer from ids)),
  $$values (0::bigint)$$,
  'ENG-06: balances are computed from the ledger');

-- Invoices: total equals the sum of lines at commit -----------------------------------
set constraints all immediate;
select throws_ok(
  format($$insert into public.invoices (tenant_id, customer_id, period_key, total_cents) values (%L, %L, 'one-off-1', 4500)$$,
         (select tenant from ids), (select customer from ids)),
  '23514', null, 'an invoice total must match its lines');
select lives_ok(
  format($$with i as (
             insert into public.invoices (tenant_id, customer_id, period_key, total_cents)
             values (%L, %L, 'one-off-2', 4500) returning tenant_id, id)
           insert into public.invoice_lines (tenant_id, invoice_id, description, unit_amount_cents, amount_cents)
           select tenant_id, id, 'Callback visit', 4500, 4500 from i$$,
         (select tenant from ids), (select customer from ids)),
  'an invoice whose lines add up passes the commit-time check');
set constraints all deferred;

-- DB-08, FR-REC-03 ----------------------------------------------------------------------
select pg_temp.login((select tech_user from ids), (select tenant from ids));
select lives_ok(
  format($$update public.applications set total_amount = 1.75 where id = %L$$, (select application from ids)),
  'DB-08: a record can be corrected within 24 hours');
select throws_ok(
  format($$delete from public.applications where id = %L$$, (select application from ids)),
  '42501', null, 'CR-04: members cannot delete application records');
reset role;

alter table public.applications disable trigger guard_application_change;
update public.applications set recorded_at = now() - interval '25 hours' where id = (select application from ids);
alter table public.applications enable trigger guard_application_change;

select pg_temp.login((select tech_user from ids), (select tenant from ids));
select throws_like(
  format($$update public.applications set total_amount = 2 where id = %L$$, (select application from ids)),
  '%locked 24 hours%', 'DB-08: after 24 hours the record is locked');
select lives_ok(
  format($$insert into public.applications (
      appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
      business_name, business_address, business_license_no, applicator_name, applicator_license_no,
      product_name, product_kind, epa_reg_no, signal_word, restricted_use, mix_rate, mix_unit,
      total_amount, amount_unit, area_treated, area_unit, target_sites, target_pests, applied_at,
      client_key, amended_from, amendment_reason)
    select appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
      business_name, business_address, business_license_no, applicator_name, applicator_license_no,
      product_name, product_kind, epa_reg_no, signal_word, restricted_use, mix_rate, mix_unit,
      2, amount_unit, area_treated, area_unit, target_sites, target_pests, applied_at,
      'amend-1', id, 'Total amount was keyed wrong'
    from public.applications where id = %L$$, (select application from ids)),
  'FR-REC-03: an amendment is a new row linked to the original');
select throws_ok(
  format($$insert into public.applications (appointment_id, client_key, amended_from, imported)
           values (%L, 'amend-2', %L, true)$$, (select appointment from ids), (select application from ids)),
  '23514', null, 'FR-REC-03: an amendment must say why');
reset role;

select throws_ok(
  format($$delete from public.applications where id = %L$$, (select application from ids)),
  '42501', null, 'CR-04: application records survive even a privileged delete');

-- CR-01 completeness, FR-REC-05, recorded_at -------------------------------------------
select throws_ok(
  format($$insert into public.applications (
      tenant_id, appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
      business_name, business_address, business_license_no, applicator_name, applicator_license_no,
      product_name, product_kind, mix_rate, mix_unit, total_amount, amount_unit, area_treated, area_unit,
      target_sites, target_pests, applied_at, client_key)
    values (%L, %L, %L, %L, 'C', 'addr', 'addr', 'B', 'addr', 'BL', 'T', 'L', 'P', 'pesticide',
            1, 'pct', 1, 'gal', 100, 'sq_ft', '{lawn}', '{grubs}', now(), 'missing-epa')$$,
         (select tenant from ids), (select appointment from ids), (select product from ids), (select technician from ids)),
  '23514', null, 'CR-01: a pesticide record without an EPA registration number cannot exist');
select throws_ok(
  format($$insert into public.applications (
      tenant_id, appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
      business_name, business_address, business_license_no, applicator_name, applicator_license_no,
      product_name, product_kind, epa_reg_no, mix_rate, mix_unit, total_amount, amount_unit, area_treated, area_unit,
      target_sites, target_pests, applied_at, client_key)
    values (%L, %L, %L, %L, 'C', 'addr', 'addr', 'B', 'addr', 'BL', 'T', 'L', 'P', 'pesticide', '1000-1',
            1, 'pct', 1, 'gal', 100, 'sq_ft', '{}', '{grubs}', now(), 'missing-site')$$,
         (select tenant from ids), (select appointment from ids), (select product from ids), (select technician from ids)),
  '23514', null, 'CR-01: a record must name at least one target site');
select throws_ok(
  format($$insert into public.applications (
      tenant_id, appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
      business_name, business_address, business_license_no, applicator_name, applicator_license_no,
      product_name, product_kind, epa_reg_no, signal_word, restricted_use, mix_rate, mix_unit, total_amount, amount_unit,
      area_treated, area_unit, target_sites, target_pests, applied_at, client_key)
    values (%L, %L, %L, %L, 'C', 'addr', 'addr', 'B', 'addr', 'BL', 'T', 'L', 'P', 'pesticide', '1000-1', 'danger', true,
            1, 'pct', 1, 'gal', 100, 'sq_ft', '{attic}', '{rodents}', now(), 'rup-no-statement')$$,
         (select tenant from ids), (select appointment from ids), (select product from ids), (select technician from ids)),
  '23514', null, 'FR-REC-05: restricted-use Danger products need the customer statement first');
select lives_ok(
  format($$insert into public.applications (tenant_id, appointment_id, client_key, imported, product_name)
           values (%L, %L, 'hist-1', true, 'Unknown legacy product')$$,
         (select tenant from ids), (select appointment from ids)),
  'FR-MIG-05: imported history may be partial');
select throws_ok(
  $$update public.applications set product_name = 'x' where client_key = 'hist-1'$$,
  '42501', null, 'FR-MIG-05: imported history is read-only');

select pg_temp.login((select tech_user from ids), (select tenant from ids));
insert into public.applications (appointment_id, client_key, imported, recorded_at)
values ((select appointment from ids), 'backdated', true, timestamptz '2020-01-01 00:00:00+00');
select ok(
  (select recorded_at > now() - interval '1 minute' from public.applications where client_key = 'backdated'),
  'DB-08: recorded_at is set by the server, not the client');
reset role;

-- ENG-05, ENG-07, R-BUG-05, status rules ------------------------------------------------
select throws_ok(
  format($$insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, local_date, tz)
           values (%L, %L, %L, %L, date '2026-10-09', 'MST')$$,
         (select tenant from ids), (select customer from ids), (select property from ids), (select service_type from ids)),
  '23503', null, 'ENG-05: an abbreviation is not an IANA zone');
select ok(
  not exists (select 1 from app.iana_zones where name in ('MST7MDT', 'US/Mountain', 'Etc/GMT+7', 'EST')),
  'ENG-05: legacy aliases and fixed offsets are not accepted zones');
select ok(
  exists (select 1 from app.iana_zones where name = 'America/Denver')
  and exists (select 1 from app.iana_zones where name = 'America/Boise')
  and exists (select 1 from app.iana_zones where name = 'America/Phoenix'),
  'ENG-05: Mountain West zones are available');
select throws_ok(
  $$insert into public.tenants (name, timezone, state, business_license_no) values ('X', 'Mars/Olympus', 'UT', 'BL')$$,
  '23503', null, 'ENG-05: tenants need a real IANA zone');
select throws_ok(
  format($$insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, status, local_date, tz)
           values (%L, %L, %L, %L, 'unscheduled', date '2026-10-09', 'America/Denver')$$,
         (select tenant from ids), (select customer from ids), (select property from ids), (select service_type from ids)),
  '23514', null, 'an unscheduled visit has no date');
select throws_ok(
  format($$update public.appointments set status = 'skipped' where id = %L$$, (select appointment from ids)),
  '23514', null, 'a skipped visit records why');

update public.customers set notes = 'Gate code 4417' where id = (select customer from ids);
select is(
  (select version from public.customers where id = (select customer from ids)), 2,
  'ENG-07: every update bumps the version');
update public.customers set version = 1, notes = 'rewind attempt' where id = (select customer from ids);
select is(
  (select version from public.customers where id = (select customer from ids)), 3,
  'ENG-07: a client cannot rewind the version');
update public.subscriptions set generated_through = date '2026-12-31' where id = (select subscription from ids);
select is(
  (select version from public.subscriptions where id = (select subscription from ids)), 1,
  'ENG-07: the generator advancing generated_through is not an edit');

update public.properties set location_locked = true where id = (select property from ids);
select throws_ok(
  format($$update public.properties set location = extensions.st_setsrid(extensions.st_makepoint(-111.0, 40.0), 4326)::extensions.geography where id = %L$$,
         (select property from ids)),
  '42501', null, 'R-BUG-05: a locked pin cannot be moved');
select lives_ok(
  format($$update public.properties set location_locked = false,
             location = extensions.st_setsrid(extensions.st_makepoint(-111.69, 40.27), 4326)::extensions.geography where id = %L$$,
         (select property from ids)),
  'R-BUG-05: unlocking and moving in one deliberate step works');

-- A subscription's property must belong to its customer.
select throws_ok(
  format($$insert into public.subscriptions (tenant_id, customer_id, property_id, plan_id, service_type_id, start_date, rrule, price_cents, billing_mode)
           select %L, c.id, %L, sp.id, sp.service_type_id, date '2026-11-01', 'FREQ=MONTHLY', 100, 'monthly'
           from public.customers c, public.service_plans sp
           where c.tenant_id = %L and c.display_name = 'Walk-in One' and sp.tenant_id = %L$$,
         (select tenant from ids), (select property from ids), (select tenant from ids), (select tenant from ids)),
  '23503', null, 'a subscription cannot pair one customer with another customer''s property');

select * from finish();
rollback;
