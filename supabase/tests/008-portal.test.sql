-- M6: the customer portal reads only its own customer (FR-POR-02, CR-10), and
-- anonymous callers can only ask for a link, open it, or unsubscribe.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(14);

create temp table fx on commit drop as select pg_temp.seed_tenant('p1') as a, pg_temp.seed_tenant('p2') as b;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'customer')::uuid as customer, (a ->> 'property')::uuid as property,
       (a ->> 'appointment')::uuid as appt, (a ->> 'invoice')::uuid as invoice,
       (b ->> 'tenant')::uuid as other_tenant, (b ->> 'customer')::uuid as other_customer
from fx;
grant select on ids to portal, anon;

-- A second customer in the same business, with their own visit.
insert into public.customers (tenant_id, display_name, email) select tenant, 'Neighbor Nash', 'nash@example.com' from ids;
create temp table nash on commit drop as select id from public.customers where display_name = 'Neighbor Nash';
grant select on nash to portal;

create or replace function pg_temp.as_portal(p_tenant uuid, p_customer uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'portal', 'portal_tenant_id', p_tenant, 'portal_customer_id', p_customer)::text, true);
  perform set_config('role', 'portal', true);
end $$;

select pg_temp.as_portal((select tenant from ids), (select customer from ids));
select is((select count(*)::int from public.customers), 1, 'the portal sees one customer: its own');
select is((select id from public.customers), (select customer from ids), '... the signed-in one');
select is((select count(*)::int from public.appointments), 1, 'its own visits only');
select is((select count(*)::int from public.invoices), 1, 'its own invoices only');
select is((select count(*)::int from public.applications), 1, 'the records of its own visits');
select is((select name from public.tenants), 'Tenant p1', 'its business by name');
select throws_ok($$select business_license_no, settings from public.tenants$$, '42501', null, 'but not the business settings');
select throws_ok($$select * from public.memberships$$, '42501', null, 'no staff list');
select lives_ok(
  format($$insert into public.service_requests (tenant_id, customer_id, property_id, request_key, message) values (%L, %L, %L, 'portal-req-1', 'Ants in the kitchen')$$,
    (select tenant from ids), (select customer from ids), (select property from ids)),
  'FR-POR-02: it can ask for service for itself');
select throws_ok(
  format($$insert into public.service_requests (tenant_id, customer_id, request_key, message) values (%L, %L, 'portal-req-2', 'Not mine')$$,
    (select tenant from ids), (select id from nash)),
  '42501', null, 'but not for another customer');
reset role;

-- Another business's customer id in the claims sees nothing of this one.
select pg_temp.as_portal((select tenant from ids), (select other_customer from ids));
select is((select count(*)::int from public.customers), 0, 'a customer id from another business sees nothing here');
reset role;

-- Anonymous: only the three functions.
set local role anon;
select throws_ok($$select * from public.customers$$, '42501', null, 'anon reads no tables');
select lives_ok(
  format($$select app.portal_issue_token(%L, 'nobody@example.com', repeat('x', 40), 'https://example.test')$$, (select tenant from ids)),
  'asking for a link for an unknown email says nothing and does nothing');
select is(app.portal_redeem_token((select tenant from ids), 'not-a-token-at-all-not-a-token-at-all'), null::uuid, 'a wrong token opens nothing');
reset role;

select * from finish();
rollback;
