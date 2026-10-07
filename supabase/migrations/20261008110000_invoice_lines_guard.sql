-- Fix: the invoice line guard asked app.purge_allowed on every insert (SQL
-- does not promise to skip the second half of an AND), and members cannot run
-- it, so the office could never add a line. Ask only on deletes.
create or replace function app.guard_invoice_lines() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    if app.purge_allowed(old.tenant_id) then
      return old;
    end if;
  end if;
  select i.status into v_status
  from public.invoices i
  where i.tenant_id = coalesce(new.tenant_id, old.tenant_id)
    and i.id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op <> 'INSERT' and v_status is distinct from 'draft' then
    raise exception 'invoice lines are fixed once the invoice is issued; post a credit instead'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

-- Same fix for append-only tables: a member's update now gets the intended
-- message instead of a permission error from purge_allowed.
create or replace function app.guard_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if app.purge_allowed(old.tenant_id) then
      return old;
    end if;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end
$$;

-- The deferred check that an invoice's total equals its lines runs as whoever
-- commits, and members could not call it. It only reads the invoice and lines
-- it is handed and raises on a mismatch, so it runs as its owner and members
-- may execute it.
alter function app.assert_invoice_total(uuid, uuid) security definer set search_path = '';
grant execute on function app.assert_invoice_total(uuid, uuid) to authenticated, service_role;
