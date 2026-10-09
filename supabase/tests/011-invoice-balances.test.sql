-- invoice_balances as a correlated subquery. PRD: ENG-06, NFR-03.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(5);

create temp table fx on commit drop as select pg_temp.seed_tenant('ib') as a;
create temp table ids on commit drop as
select (a ->> 'tenant')::uuid as tenant, (a ->> 'customer')::uuid as customer from fx;

-- Three invoices: one part credited, one paid, one with no ledger rows at all.
insert into public.invoices (tenant_id, customer_id, period_key, status, total_cents, issued_at, due_date)
select tenant, customer, p, 'open', t, now(), current_date from ids, (values ('ib-1', 5000), ('ib-2', 3000), ('ib-3', 700)) v(p, t);
insert into public.ledger_entries (tenant_id, customer_id, type, amount_cents, invoice_id, entry_key)
select i.tenant_id, i.customer_id, 'invoice', i.total_cents, i.id, 'invoice:' || i.period_key from public.invoices i where i.period_key in ('ib-1', 'ib-2');
insert into public.ledger_entries (tenant_id, customer_id, type, amount_cents, invoice_id, entry_key)
select i.tenant_id, i.customer_id, 'credit', -1200, i.id, 'credit:ib-1' from public.invoices i where i.period_key = 'ib-1';
insert into public.ledger_entries (tenant_id, customer_id, type, amount_cents, invoice_id, entry_key)
select i.tenant_id, i.customer_id, 'credit', -3000, i.id, 'pay:ib-2' from public.invoices i where i.period_key = 'ib-2';

-- The previous grouped-join definition, kept here as the reference.
create temp table old_def on commit drop as
select i.tenant_id, i.id as invoice_id, i.customer_id, i.number, i.status, i.due_date, i.total_cents,
       (i.total_cents + coalesce(sum(l.amount_cents) filter (where l.type <> 'invoice'), 0))::bigint as open_cents
from public.invoices i
left join public.ledger_entries l on l.tenant_id = i.tenant_id and l.invoice_id = i.id
group by i.tenant_id, i.id;

select is((select count(*)::int from public.invoice_balances b join public.invoices i on i.id = b.invoice_id where b.tenant_id = (select tenant from ids) and i.period_key like 'ib-%'), 3, 'ENG-06: one balance row per invoice');
select is_empty($$select * from old_def except select * from public.invoice_balances$$, 'open_cents equals the old definition (old minus new)');
select is_empty($$select * from public.invoice_balances except select * from old_def$$, 'open_cents equals the old definition (new minus old)');
select results_eq(
  $$select open_cents from public.invoice_balances b join public.invoices i on i.id = b.invoice_id where b.tenant_id = (select tenant from ids) and i.period_key like 'ib-%' order by b.total_cents desc$$,
  $$values (3800::bigint), (0::bigint), (700::bigint)$$,
  'credit, payment and untouched invoice balances');
select is((select reloptions::text from pg_class where oid = 'public.invoice_balances'::regclass), '{security_invoker=true}', 'NFR-03: the view still runs with the caller''s rights');

select * from finish();
rollback;
