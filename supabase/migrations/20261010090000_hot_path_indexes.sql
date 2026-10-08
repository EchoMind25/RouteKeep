-- NFR-03: indexes for queries that otherwise scan a whole tenant (or every
-- tenant). Found in the 2026-10 review; each names the query it serves.

-- Customer list "next visit" subquery, the customer page, the portal's RLS
-- filter (customer_id = portal_customer_id()), and FK checks on customer delete.
create index if not exists appointments_customer on public.appointments (tenant_id, customer_id, local_date);

-- portal_issue_token looks a customer up by email on an anonymous endpoint.
create index if not exists customers_email on public.customers (tenant_id, email) where email is not null;

-- app.system_status() (public /status page, NFR-04) counts failed messages and
-- reads the last billing run across all tenants.
create index if not exists messages_failed_recent on public.messages (created_at) where status = 'failed';
create index if not exists billing_runs_started on public.billing_runs (started_at desc);
create index if not exists billing_runs_finished on public.billing_runs (finished_at desc) where finished_at is not null;

-- Revenue report: ledger entries in a date range within a tenant.
create index if not exists ledger_occurred on public.ledger_entries (tenant_id, occurred_at);
