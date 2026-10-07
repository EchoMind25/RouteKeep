-- M4 stage 1: invoicing, manual payments and the ledger (FR-BIL-01, 03, 04, 06).

-- A payment taken at a stop knows which visit it was for, so the billing run
-- can apply it to that visit's invoice (FR-TEC-08, FR-BIL-01).
alter table public.payments add column appointment_id uuid;
alter table public.payments
  add constraint payments_appointment foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id);
create index payments_appointment on public.payments (tenant_id, appointment_id) where appointment_id is not null;

-- The office marks an invoice paid when the ledger says it is; paid_at must go
-- with the status (paid_is_dated).
grant update (paid_at) on public.invoices to authenticated;

-- An invoice is paid in full, or voided, once; it never reopens by a member's
-- hand. Corrections are credits (FR-BIL-06).
create or replace function app.guard_invoice_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status in ('void', 'uncollectible') and current_user in ('authenticated', 'anon') then
    raise exception 'a % invoice stays that way; post a credit or a new invoice', old.status using errcode = '23514';
  end if;
  if new.status = 'draft' then
    raise exception 'an issued invoice cannot go back to draft' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.guard_invoice_status() from public;
create trigger guard_invoice_status before update on public.invoices
  for each row execute function app.guard_invoice_status();

-- FR-BIL-03: what each billing run did, item by item, so a failure is visible
-- and a rerun only retries what failed.
create table public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid default auth.uid(),
  invoices_created integer not null default 0,
  payments_posted integer not null default 0,
  failures jsonb not null default '[]'::jsonb check (jsonb_typeof(failures) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index billing_runs_recent on public.billing_runs (tenant_id, started_at desc);
call app.secure_table('public.billing_runs',
  p_select => '{owner,admin,office}', p_insert => '{owner,admin,office}', p_update => '{owner,admin,office}', p_delete => '{}');
