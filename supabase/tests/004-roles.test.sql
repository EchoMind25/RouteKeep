-- Who may do what inside a tenant, tenant creation, member management, and
-- the access token hook. PRD: FR-SET-01, FR-SET-02, CR-05, ENG-08, FR-DSP-03, FR-DSP-06.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(34);

create temp table fx on commit drop as select pg_temp.seed_tenant('a') as a;
create temp table ids on commit drop as
select
  (a ->> 'tenant')::uuid as tenant,
  (a ->> 'owner')::uuid as owner,
  (a ->> 'admin')::uuid as admin,
  (a ->> 'office')::uuid as office,
  (a ->> 'dispatcher')::uuid as dispatcher,
  (a ->> 'tech_user')::uuid as tech_user,
  (a ->> 'service_type')::uuid as service_type,
  (a ->> 'customer')::uuid as customer,
  (a ->> 'appointment')::uuid as appointment,
  (a ->> 'route')::uuid as route,
  (a ->> 'technician')::uuid as technician,
  pg_temp.new_user('new-admin@test.routeverde.dev') as new_admin,
  pg_temp.new_user('new-tech@test.routeverde.dev') as new_tech,
  pg_temp.new_user('sneaky-owner@test.routeverde.dev') as sneaky_owner
from fx;
grant select on ids to authenticated;

-- Technician ------------------------------------------------------------------------
select pg_temp.login((select tech_user from ids), (select tenant from ids));
select throws_ok(
  format($$insert into public.service_plans (service_type_id, name, price_cents, rrule)
           values (%L, 'Tech plan', 100, 'FREQ=MONTHLY')$$, (select service_type from ids)),
  '42501', null, 'a technician cannot create plans');
select throws_ok(
  $$insert into public.customers (display_name) values ('Tech-made customer')$$,
  '42501', null, 'a technician cannot create customers');
select lives_ok(
  format($$update public.appointments set status = 'in_progress', arrived_at = now() where id = %L$$,
         (select appointment from ids)),
  'a technician can work their stop');
select lives_ok(
  format($$insert into public.payments (customer_id, client_payment_key, method, status, amount_cents, received_at)
           values (%L, 'field-cash-000001', 'cash', 'succeeded', 6500, now())$$, (select customer from ids)),
  'a technician can record cash collected in the field');
select is((select count(*) from public.audit_log), 0::bigint, 'a technician cannot read the audit log');
select is((select count(*) from public.import_jobs), 0::bigint, 'a technician cannot see imports');
update public.routes set published_at = now(), published_order = '[]' where id = (select route from ids);
select is(
  (select published_at from public.routes where id = (select route from ids)), null,
  'FR-DSP-06: a technician cannot publish their own route');
select throws_ok(
  format($$insert into public.routes (technician_id, local_date) values (%L, date '2026-10-09')$$, (select technician from ids)),
  '42501', null, 'FR-DSP-03: a technician cannot create or reorder routes');
reset role;

-- Office ------------------------------------------------------------------------------
select pg_temp.login((select office from ids), (select tenant from ids));
select lives_ok(
  $$insert into public.customers (display_name, phone) values ('Teodoro Vance', '+18015550178')$$,
  'office can create customers');
select throws_ok(
  $$insert into public.products (name, kind) values ('Office product', 'fertilizer')$$,
  '42501', null, 'office cannot change the product catalog');
select throws_ok(
  format($$insert into public.payments (customer_id, client_payment_key, method, status, amount_cents, received_at)
           values (%L, 'fake-card-000001', 'card', 'succeeded', 6500, now())$$, (select customer from ids)),
  '42501', null, 'CR-05: nobody can record a card payment as paid; only Stripe''s answer can');
select lives_ok(
  format($$insert into public.payments (customer_id, client_payment_key, method, status, amount_cents)
           values (%L, 'card-pending-000001', 'card', 'pending', 6500)$$, (select customer from ids)),
  'a pending card payment can be started');
select throws_ok(
  $$update public.payments set status = 'succeeded' where client_payment_key = 'card-pending-000001'$$,
  '42501', null, 'members cannot change a payment''s status');
update public.tenants set name = 'Renamed by office' where id = (select tenant from ids);
select isnt(
  (select name from public.tenants where id = (select tenant from ids)), 'Renamed by office',
  'office cannot rename the business');
reset role;

-- Dispatcher ----------------------------------------------------------------------------
select pg_temp.login((select dispatcher from ids), (select tenant from ids));
select throws_ok(
  format($$insert into public.subscriptions (customer_id, property_id, plan_id, service_type_id, start_date, rrule, price_cents, billing_mode)
           select s.customer_id, s.property_id, s.plan_id, s.service_type_id, date '2026-12-01', s.rrule, s.price_cents, s.billing_mode
           from public.subscriptions s limit 1$$),
  '42501', null, 'a dispatcher cannot sell plans');
select lives_ok(
  format($$update public.appointments set local_date = date '2026-10-08' where id = %L$$, (select appointment from ids)),
  'a dispatcher can move a visit');
select lives_ok(
  format($$update public.routes set published_at = now(), published_order = '["%s"]', flagged_stops = 1 where id = %L$$,
         (select appointment from ids), (select route from ids)),
  'FR-DSP-06: a dispatcher publishes a route, recording the order and the warnings accepted');
select throws_ok(
  format($$update public.routes set published_order = '{"order": []}' where id = %L$$, (select route from ids)),
  '23514', null, 'the published order is a list');
reset role;

-- Owner and admin -------------------------------------------------------------------------
select pg_temp.login((select owner from ids), (select tenant from ids));
select lives_ok(
  format($$update public.tenants set name = 'Wasatch Front Pest' where id = %L$$, (select tenant from ids)),
  'the owner can rename the business');
select throws_ok(
  format($$update public.tenants set plan = 'growth' where id = %L$$, (select tenant from ids)),
  '42501', null, 'the plan changes only through billing, not by a member');
select throws_ok(
  format($$update public.tenants set stripe_charges_enabled = true where id = %L$$, (select tenant from ids)),
  '42501', null, 'Stripe status changes only through Stripe');
select cmp_ok((select count(*) from public.audit_log), '>', 0::bigint, 'the owner can read the audit log');
select lives_ok(
  format($$select app.add_member(%L, 'new-admin@test.routeverde.dev', 'admin', 'New Admin')$$,
         (select new_admin from ids)),
  'FR-SET-02: the owner can add an admin');
select throws_ok(
  format($$select app.deactivate_member(id) from public.memberships where user_id = %L$$, (select owner from ids)),
  '23514', null, 'the last owner cannot remove themself');
select throws_ok(
  format($$select app.set_member_role(id, 'admin') from public.memberships where user_id = %L$$, (select owner from ids)),
  '23514', null, 'the last owner cannot demote themself');
reset role;

select pg_temp.login((select admin from ids), (select tenant from ids));
select lives_ok(
  format($$select app.add_member(%L, 'new-tech@test.routeverde.dev', 'technician', 'New Tech')$$,
         (select new_tech from ids)),
  'FR-SET-02: an admin can add a technician');
select throws_ok(
  format($$select app.add_member(%L, 'sneaky-owner@test.routeverde.dev', 'owner', null)$$,
         (select sneaky_owner from ids)),
  '42501', null, 'an admin cannot create an owner');
select throws_ok(
  format($$select app.set_member_role(id, 'office') from public.memberships where user_id = %L$$, (select owner from ids)),
  '42501', null, 'an admin cannot demote the owner');
reset role;

-- Tenant creation (FR-SET-01) -----------------------------------------------------------------
create temp table newbie on commit drop as select pg_temp.new_user('fresh-owner@test.routeverde.dev') as id;
grant select on newbie to authenticated;
select set_config('request.jwt.claims',
  jsonb_build_object('sub', (select id from newbie), 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from public.tenants), 0::bigint, 'a new user without a tenant sees nothing');
create temp table created on commit drop as
select app.create_tenant('Bonneville Bug & Lawn', 'America/Denver', 'UT', 'UT-BUS-88213',
                         '455 W 200 S', null, 'Salt Lake City', '84101', null, 'signup-key-1') as id;
select is(
  app.create_tenant('Bonneville Bug & Lawn', 'America/Denver', 'UT', 'UT-BUS-88213',
                    '455 W 200 S', null, 'Salt Lake City', '84101', null, 'signup-key-1'),
  (select id from created),
  'ENG-01: a double-submitted signup returns the same tenant');
reset role;
select is(
  (select role from public.memberships where tenant_id = (select id from created) and user_id = (select id from newbie)),
  'owner', 'the creator becomes the owner');
select is(
  (select count(*) from public.service_types where tenant_id = (select id from created)), 4::bigint,
  'a new tenant starts with one service type per category');

-- Access token hook -------------------------------------------------------------------------------
select is(
  public.custom_access_token_hook(jsonb_build_object(
    'user_id', (select id from newbie), 'claims', jsonb_build_object('sub', (select id from newbie)))) #>> '{claims,tenant_id}',
  (select id::text from created),
  'the access token carries the member''s tenant');
select is(
  public.custom_access_token_hook(jsonb_build_object(
    'user_id', gen_random_uuid(), 'claims', jsonb_build_object('tenant_id', (select tenant::text from ids)))) #>> '{claims,tenant_id}',
  null,
  'a user with no membership gets no tenant claim, whatever the token said before');

select * from finish();
rollback;
