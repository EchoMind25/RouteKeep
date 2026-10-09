-- Migration in and out.
-- PRD: section 9 (FR-MIG-01..19), FR-EXP-01..03, DB-06.

-- Presets and saved mappings (FR-MIG-01, FR-MIG-03). Rows with tenant_id null
-- are shared presets every tenant can read; only the platform (service_role)
-- writes them. Tenants read shared presets and manage their own.
create table public.import_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  source text not null check (source in ('fieldroutes', 'pestpac', 'gorilladesk', 'jobber', 'quickbooks', 'csv', 'routeverde')),
  entity text not null check (entity in (
    'customers', 'properties', 'service_plans', 'subscriptions', 'appointments', 'technicians',
    'products', 'applications', 'invoices', 'balances', 'notes', 'documents')),
  column_map jsonb not null default '{}'::jsonb check (jsonb_typeof(column_map) = 'object'),
  transforms jsonb not null default '{}'::jsonb check (jsonb_typeof(transforms) = 'object'),
  header_signature text[] not null default '{}',
  is_preset boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index import_mappings_lookup on public.import_mappings (source, entity);

alter table public.import_mappings enable row level security;
revoke all on table public.import_mappings from public, anon, authenticated;
grant select, insert, update, delete on table public.import_mappings to service_role;
grant select, insert, update, delete on table public.import_mappings to authenticated;
create policy shared_or_own on public.import_mappings as permissive for select to authenticated
  using (tenant_id is null or tenant_id = (select app.current_tenant_id()));
create policy own_write on public.import_mappings as permissive for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_role('{owner,admin}')));
create policy own_update on public.import_mappings as permissive for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_role('{owner,admin}')))
  with check (tenant_id = (select app.current_tenant_id()));
create policy own_delete on public.import_mappings as permissive for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_role('{owner,admin}')));
create trigger touch_updated_at before update on public.import_mappings
  for each row execute function app.touch_updated_at();
call app.add_version_trigger('public.import_mappings');

-- Import jobs (FR-MIG-08..14) ---------------------------------------------------------

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  source text not null check (source in ('fieldroutes', 'pestpac', 'gorilladesk', 'jobber', 'quickbooks', 'csv', 'routeverde')),
  status text not null default 'uploaded' check (status in (
    'uploaded', 'mapped', 'validating', 'validated', 'committing', 'committed',
    'reconciled', 'rolling_back', 'rolled_back', 'failed')),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  mapping_ids uuid[] not null default '{}',
  shadow boolean not null default false,
  delta_of uuid,
  dry_run_report jsonb,
  reconcile_report jsonb,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  error text,
  created_by uuid default auth.uid(),
  committed_at timestamptz,
  rollback_deadline timestamptz,
  rolled_back_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, delta_of) references public.import_jobs (tenant_id, id),
  constraint rollback_window check (committed_at is null or rollback_deadline is not null)
);

call app.secure_table('public.import_jobs',
  p_select => '{owner,admin}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{}');
call app.add_version_trigger('public.import_jobs');

-- Staging (FR-MIG-10): every source row lands here with a status and reasons.
create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  job_id uuid not null,
  entity text not null,
  file_name text not null,
  row_number integer not null check (row_number > 0),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  mapped jsonb check (mapped is null or jsonb_typeof(mapped) = 'object'),
  external_ref text,
  status text not null default 'pending' check (status in (
    'pending', 'valid', 'invalid', 'duplicate', 'committed', 'skipped', 'rolled_back')),
  action text check (action in ('create', 'update', 'skip')),
  reasons text[] not null default '{}',
  target_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, job_id, entity, file_name, row_number),
  foreign key (tenant_id, job_id) references public.import_jobs (tenant_id, id) on delete cascade
);
create index import_rows_status on public.import_rows (tenant_id, job_id, status);

call app.secure_table('public.import_rows',
  p_select => '{owner,admin}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Imported entities point back at the job that created them so a rollback can
-- find exactly those rows (FR-MIG-14).
alter table public.customers add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.properties add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.technicians add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.service_plans add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.products add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.subscriptions add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.appointments add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.applications add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.invoices add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.payments add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);
alter table public.ledger_entries add foreign key (tenant_id, import_job_id) references public.import_jobs (tenant_id, id);

-- Exports (FR-EXP-01, FR-EXP-02) -----------------------------------------------------------

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  requested_by uuid default auth.uid(),
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  format_version text not null default '1',
  path text,
  size_bytes bigint check (size_bytes >= 0),
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ready_has_file check (status <> 'ready' or (path is not null and expires_at is not null))
);

call app.secure_table('public.exports',
  p_select => '{owner,admin}', p_insert => '{owner,admin}', p_update => '{}', p_delete => '{}');

revoke all on all functions in schema app from public;
