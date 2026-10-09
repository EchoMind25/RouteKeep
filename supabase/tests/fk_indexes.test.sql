-- Every foreign key in public has an index led by its columns, or a reason not to.
-- PRD: DB-05, ENG-08, NFR-03. An unindexed child key makes every parent delete or
-- "rows for this parent" lookup scan the child table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- Allowlist: constraint name and why no index is needed. Add an index instead
-- unless the parent is never deleted and the child is never looked up by it.
create temp table fk_allow (conname text primary key, reason text not null) on commit drop;
insert into fk_allow values
  ('tenants_timezone_fkey', 'reference list app.iana_zones is never deleted from'),
  ('appointments_tz_fkey', 'reference list app.iana_zones is never deleted from'),
  ('memberships_invited_by_fkey', 'auth.users rows are removed only by account deletion, a rare admin job'),
  ('technicians_user_id_fkey', 'auth.users rows are removed only by account deletion, a rare admin job'),
  ('technicians_tenant_id_import_job_id_fkey', 'import jobs are never deleted; rollback finds rows by import_job_id on a few thousand rows once'),
  ('service_plans_tenant_id_import_job_id_fkey', 'import jobs are never deleted; small table'),
  ('products_tenant_id_import_job_id_fkey', 'import jobs are never deleted; small table'),
  ('invoices_tenant_id_import_job_id_fkey', 'import jobs are never deleted; rollback is a one-off job'),
  ('payments_tenant_id_import_job_id_fkey', 'import jobs are never deleted; rollback is a one-off job'),
  ('ledger_entries_tenant_id_import_job_id_fkey', 'import jobs are never deleted; ledger is append-only'),
  ('import_jobs_tenant_id_delta_of_fkey', 'import jobs are never deleted; a handful per tenant'),
  ('subscriptions_tenant_id_customer_id_property_id_fkey', 'properties are never deleted (customers are archived); lookups go by customer_id'),
  ('subscriptions_tenant_id_plan_id_fkey', 'service plans are deactivated, never deleted'),
  ('subscriptions_tenant_id_preferred_technician_id_fkey', 'technicians are deactivated, never deleted'),
  ('subscriptions_tenant_id_service_type_id_fkey', 'service types are deactivated, never deleted'),
  ('appointments_tenant_id_customer_id_property_id_fkey', 'properties are never deleted; appointments are read by date and customer'),
  ('appointments_tenant_id_service_type_id_fkey', 'service types are deactivated, never deleted'),
  ('appointments_tenant_id_subscription_id_property_id_fkey', 'subscriptions are cancelled, never deleted; visits are read by date and technician'),
  ('appointments_tenant_id_technician_id_fkey', 'technicians are deactivated, never deleted'),
  ('applications_tenant_id_product_id_fkey', 'products are deactivated, never deleted'),
  ('payments_payment_method', 'payment methods are detached (status), never deleted'),
  ('ledger_entries_tenant_id_payment_id_fkey', 'payments are never deleted and the ledger is append-only (ENG-06)'),
  ('messages_tenant_id_invoice_id_fkey', 'invoices are voided, never deleted; the message log is read by customer'),
  ('messages_tenant_id_outbox_event_id_fkey', 'outbox events are not deleted while messages exist; messages are read by customer'),
  ('webhook_events_tenant_id_fkey', 'tenants are never hard-deleted; webhook rows are looked up by event id'),
  ('sync_conflicts_tenant_id_technician_id_fkey', 'technicians are deactivated, never deleted'),
  ('commissions_tenant_id_subscription_id_fkey', 'subscriptions are cancelled, never deleted'),
  ('service_requests_tenant_id_customer_id_fkey', 'customers are archived, never deleted'),
  ('service_requests_tenant_id_customer_id_property_id_fkey', 'properties are never deleted'),
  ('reconciliation_issues_tenant_id_payment_id_fkey', 'payments are never deleted; a short-lived issue list'),
  ('tech_day_notices_tenant_id_technician_id_fkey', 'technicians are deactivated, never deleted');

-- Foreign keys with no valid index whose leading columns are exactly the key's columns.
create temp table unindexed on commit drop as
select c.conname::text as conname
from pg_constraint c
join pg_namespace n on n.oid = c.connamespace
where c.contype = 'f' and n.nspname = 'public'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid and i.indisvalid
      and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
      and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
  );

select is_empty($$select conname from unindexed where conname not in (select conname from fk_allow) order by 1$$,
  'DB-05: every foreign key is indexed or allowlisted with a reason');
select is_empty($$select conname from fk_allow where conname not in (select conname from unindexed) order by 1$$,
  'DB-05: no allowlist entry is stale (each one is still unindexed)');

select * from finish();
rollback;
