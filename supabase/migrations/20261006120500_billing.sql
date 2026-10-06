-- Billing: invoices, invoice lines, payments, the append-only ledger, and the
-- views reports read from.
-- PRD: FR-BIL-01..08, FR-MIG-06, DB-01, DB-02, DB-07, ENG-01, ENG-02, ENG-06, CR-05, CR-12.
-- No card or bank data is ever stored here (CR-05); Stripe holds it.

-- Per-tenant counters (invoice numbers). Private: only reachable through
-- app.next_counter, which the invoice trigger calls.
create table app.tenant_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null,
  value bigint not null default 0,
  primary key (tenant_id, key)
);

create or replace function app.next_counter(p_tenant_id uuid, p_key text) returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into app.tenant_counters as c (tenant_id, key, value)
  values (p_tenant_id, p_key, 1)
  on conflict (tenant_id, key) do update set value = c.value + 1
  returning value
$$;

-- Invoices -------------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  subscription_id uuid,
  appointment_id uuid,
  number bigint not null,
  -- FR-BIL-01: one invoice per subscription period. per_service: the occurrence
  -- date (2026-10-14); monthly: 2026-10; quarterly: 2026-Q4; annually: 2026.
  period_key text not null check (length(period_key) between 1 and 64),
  status text not null default 'open' check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  total_cents integer not null check (total_cents >= 0),
  issued_at timestamptz,
  due_date date,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  constraint invoices_period unique (tenant_id, subscription_id, period_key),
  constraint invoices_appointment unique (tenant_id, appointment_id),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, subscription_id) references public.subscriptions (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id),
  constraint void_is_explained check (status <> 'void' or (voided_at is not null and void_reason is not null)),
  constraint paid_is_dated check (status <> 'paid' or paid_at is not null)
);
create index invoices_customer on public.invoices (tenant_id, customer_id, issued_at desc);
create index invoices_open on public.invoices (tenant_id, due_date) where status = 'open';

create or replace function app.assign_invoice_number() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null then
    new.number := app.next_counter(new.tenant_id, 'invoice');
  end if;
  return new;
end
$$;
create trigger assign_invoice_number before insert on public.invoices
  for each row execute function app.assign_invoice_number();

call app.secure_table('public.invoices',
  p_select => '{*}', p_insert => '{owner,admin,office}', p_update => '{}', p_delete => '{}');
-- Totals and numbers are fixed once issued; corrections are credits (FR-BIL-06).
grant update (status, due_date, voided_at, void_reason, issued_at) on public.invoices to authenticated;
create policy roles_update on public.invoices as restrictive for update to authenticated
  using ((select app.has_role('{owner,admin,office}')))
  with check ((select app.has_role('{owner,admin,office}')));

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  appointment_id uuid,
  description text not null check (length(btrim(description)) between 1 and 300),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_amount_cents integer not null,
  amount_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id),
  constraint line_amount check (amount_cents = round(quantity * unit_amount_cents))
);
create index invoice_lines_invoice on public.invoice_lines (tenant_id, invoice_id);

-- Lines change only while the invoice is a draft.
create or replace function app.guard_invoice_lines() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select i.status into v_status
  from public.invoices i
  where i.tenant_id = coalesce(new.tenant_id, old.tenant_id)
    and i.id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'DELETE' and app.purge_allowed(old.tenant_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and v_status is distinct from 'draft' then
    raise exception 'invoice lines are fixed once the invoice is issued; post a credit instead'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
create trigger guard_invoice_lines before insert or update or delete on public.invoice_lines
  for each row execute function app.guard_invoice_lines();

-- At commit, every invoice's total equals the sum of its lines. Deferred so an
-- invoice and its lines can be written in any order inside one transaction.
create or replace function app.assert_invoice_total(p_tenant_id uuid, p_invoice_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_sum bigint;
begin
  select i.total_cents into v_total
  from public.invoices i
  where i.tenant_id = p_tenant_id and i.id = p_invoice_id;
  if v_total is null then
    return;
  end if;
  select coalesce(sum(l.amount_cents), 0) into v_sum
  from public.invoice_lines l
  where l.tenant_id = p_tenant_id and l.invoice_id = p_invoice_id;
  if v_sum <> v_total then
    raise exception 'invoice % total % does not match its lines (%)', p_invoice_id, v_total, v_sum
      using errcode = '23514';
  end if;
end
$$;

create or replace function app.check_invoice_total_from_invoice() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_invoice_total(new.tenant_id, new.id);
  return null;
end
$$;

create or replace function app.check_invoice_total_from_line() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.assert_invoice_total(old.tenant_id, old.invoice_id);
  else
    perform app.assert_invoice_total(new.tenant_id, new.invoice_id);
  end if;
  return null;
end
$$;

create constraint trigger invoice_total_matches_lines
  after insert or update of total_cents on public.invoices
  deferrable initially deferred
  for each row execute function app.check_invoice_total_from_invoice();
create constraint trigger invoice_lines_match_total
  after insert or update or delete on public.invoice_lines
  deferrable initially deferred
  for each row execute function app.check_invoice_total_from_line();

call app.secure_table('public.invoice_lines',
  p_select => '{*}', p_insert => '{owner,admin,office}', p_update => '{owner,admin,office}', p_delete => '{owner,admin,office}');

-- Payments (FR-BIL-02, FR-TEC-08) ---------------------------------------------------------
-- client_payment_key is generated on the device or in the browser before the
-- first attempt, so a retry or a double tap lands on the same row (DB-01).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  invoice_id uuid,
  client_payment_key text not null check (length(client_payment_key) between 8 and 128),
  method text not null check (method in ('card', 'ach', 'card_on_file', 'cash', 'check', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
  amount_cents integer not null check (amount_cents > 0),
  refunded_cents integer not null default 0,
  stripe_payment_intent_id text,
  failure_code text,
  failure_message text,
  check_number text,
  collected_by uuid default auth.uid(),
  received_at timestamptz,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint payments_client_key unique (tenant_id, client_payment_key),
  constraint payments_intent unique (stripe_payment_intent_id),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  constraint refund_bounds check (refunded_cents between 0 and amount_cents),
  constraint succeeded_is_dated check (status <> 'succeeded' or received_at is not null)
);
create index payments_customer on public.payments (tenant_id, customer_id, created_at desc);
create index payments_invoice on public.payments (tenant_id, invoice_id);
create index payments_failed on public.payments (tenant_id, created_at) where status = 'failed';

call app.secure_table('public.payments',
  p_select => '{*}', p_insert => '{owner,admin,office,technician}', p_update => '{}', p_delete => '{}');
-- Members record cash and checks. Card and bank payments are created pending and
-- only server code holding Stripe's answer (service_role) can mark them paid.
create policy manual_methods_only on public.payments as restrictive for insert to authenticated
  with check (method in ('cash', 'check', 'other') or (status = 'pending' and stripe_payment_intent_id is null));

-- Ledger (FR-BIL-06, DB-07, ENG-06) --------------------------------------------------------
-- Positive amounts increase what the customer owes. entry_key makes every
-- posting idempotent: invoice:<id>, payment:<id>, refund:<stripe refund id>,
-- opening:<import job>:<external ref>, or a client key for manual credits.

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  type text not null check (type in ('invoice', 'payment', 'credit', 'refund', 'opening_balance')),
  amount_cents integer not null,
  invoice_id uuid,
  payment_id uuid,
  entry_key text not null check (length(entry_key) between 1 and 200),
  memo text,
  occurred_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ledger_entry_key unique (tenant_id, entry_key),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, payment_id) references public.payments (tenant_id, id),
  constraint ledger_sign check (
    (type = 'invoice' and amount_cents > 0)
    or (type = 'payment' and amount_cents < 0)
    or (type = 'credit' and amount_cents < 0)
    or (type = 'refund' and amount_cents > 0)
    or (type = 'opening_balance' and amount_cents <> 0)
  ),
  constraint ledger_refs check (
    (type <> 'invoice' or invoice_id is not null)
    and (type not in ('payment', 'refund') or payment_id is not null)
  )
);
create index ledger_customer on public.ledger_entries (tenant_id, customer_id, occurred_at);
create index ledger_invoice on public.ledger_entries (tenant_id, invoice_id) where invoice_id is not null;

create trigger guard_immutable before update or delete on public.ledger_entries
  for each row execute function app.guard_immutable();

call app.secure_table('public.ledger_entries',
  p_select => '{*}', p_insert => '{owner,admin,office}', p_update => '{}', p_delete => '{}');

-- DB-07: belt and braces. No role but the table owner holds UPDATE or DELETE,
-- and the trigger above stops the owner too.
revoke update, delete, truncate on public.ledger_entries from authenticated, service_role, anon;

-- Report views (ENG-06). security_invoker keeps RLS in force for the caller.

create view public.customer_balances with (security_invoker = true) as
select
  l.tenant_id,
  l.customer_id,
  sum(l.amount_cents)::bigint as balance_cents,
  max(l.occurred_at) as last_activity_at
from public.ledger_entries l
group by l.tenant_id, l.customer_id;

create view public.invoice_balances with (security_invoker = true) as
select
  i.tenant_id,
  i.id as invoice_id,
  i.customer_id,
  i.number,
  i.status,
  i.due_date,
  i.total_cents,
  (i.total_cents + coalesce(sum(l.amount_cents) filter (where l.type <> 'invoice'), 0))::bigint as open_cents
from public.invoices i
left join public.ledger_entries l
  on l.tenant_id = i.tenant_id and l.invoice_id = i.id
group by i.tenant_id, i.id;

revoke all on public.customer_balances, public.invoice_balances from public, anon;
grant select on public.customer_balances, public.invoice_balances to authenticated, service_role;

revoke all on all functions in schema app from public;
