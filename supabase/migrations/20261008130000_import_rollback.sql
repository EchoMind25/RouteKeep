-- FR-MIG-14: an import can be undone within 7 days. Append-only rows the
-- import itself created (opening balances) may then be removed, but only by
-- the rollback job (service role, with app.rollback_import_job_id set to that
-- import), and only rows that carry that import's id.
create or replace function app.guard_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if app.purge_allowed(old.tenant_id, nullif(to_jsonb(old) ->> 'import_job_id', '')::uuid) then
      return old;
    end if;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end
$$;

revoke all on all functions in schema app from public;
-- Restore the executes that the blanket revoke above takes away (see 20261008110000).
grant execute on function app.assert_invoice_total(uuid, uuid) to authenticated, service_role;

-- FR-EXP-01, FR-EXP-02, D-04: an export is built in short steps, one part at a
-- time (tables, records by month, attachments), then assembled.
alter table public.exports add column progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object');
grant update (status, path, size_bytes, expires_at, error, progress) on public.exports to authenticated;
create policy roles_update on public.exports as restrictive for update to authenticated
  using ((select app.has_role('{owner,admin}'))) with check ((select app.has_role('{owner,admin}')));

-- The ledger refuses deletes from every role (ENG-06). The one exception is an
-- import's own opening balances during that import's rollback: this function,
-- callable only by the service role, removes exactly those rows.
create or replace function app.rollback_import_ledger(p_tenant_id uuid, p_import_job_id uuid, p_customer_ids uuid[]) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(current_setting('app.rollback_import_job_id', true), '') <> p_import_job_id::text then
    raise exception 'not rolling back this import' using errcode = '42501';
  end if;
  delete from public.ledger_entries
  where tenant_id = p_tenant_id
    and import_job_id = p_import_job_id
    and type = 'opening_balance'
    and customer_id = any(p_customer_ids);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function app.rollback_import_ledger(uuid, uuid, uuid[]) from public, authenticated, anon;
grant execute on function app.rollback_import_ledger(uuid, uuid, uuid[]) to service_role;
