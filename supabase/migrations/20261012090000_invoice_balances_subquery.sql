-- invoice_balances as a correlated subquery. PRD: ENG-06, NFR-03.
-- The grouped join aggregated the whole tenant's ledger whenever the view was
-- joined rather than filtered by invoice id (customer page, billing list). The
-- scalar subquery is evaluated only for invoices that survive the outer filters.
-- Same columns, types, security_invoker and grants.
create or replace view public.invoice_balances with (security_invoker = true) as
select
  i.tenant_id,
  i.id as invoice_id,
  i.customer_id,
  i.number,
  i.status,
  i.due_date,
  i.total_cents,
  (i.total_cents + coalesce((
    select sum(l.amount_cents)
    from public.ledger_entries l
    where l.tenant_id = i.tenant_id and l.invoice_id = i.id and l.type <> 'invoice'
  ), 0))::bigint as open_cents
from public.invoices i;

revoke all on public.invoice_balances from public, anon;
grant select on public.invoice_balances to authenticated, service_role, portal;
