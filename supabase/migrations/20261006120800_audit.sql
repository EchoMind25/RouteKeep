-- Audit log on financial and compliance tables (CR-12) and on who can do what.
-- Rows are written by a SECURITY DEFINER trigger, so members never need (or
-- get) direct write access, and nobody can edit or remove history.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_id uuid,
  actor_role text,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index audit_log_row on public.audit_log (tenant_id, table_name, row_id, at);

call app.secure_table('public.audit_log',
  p_select => '{owner,admin}', p_insert => '{}', p_update => '{}', p_delete => '{}');

create trigger guard_immutable before update or delete on public.audit_log
  for each row execute function app.guard_immutable();

create or replace function app.audit_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_after, v_before);
  v_tenant uuid;
begin
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;
  v_tenant := coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid end);
  -- A tenant being purged takes its audit trail with it; nothing to record.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return null;
  end if;
  insert into public.audit_log (tenant_id, actor_id, actor_role, table_name, row_id, action, before, after)
  values (
    v_tenant,
    auth.uid(),
    coalesce(auth.jwt() ->> 'user_role', current_user::text),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    v_before,
    v_after
  );
  return null;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'memberships', 'technicians', 'products', 'service_plans',
    'applications', 'agreements',
    'invoices', 'invoice_lines', 'payments', 'ledger_entries'
  ] loop
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I '
      'for each row execute function app.audit_row()', t);
  end loop;
end
$$;

revoke all on all functions in schema app from public;
