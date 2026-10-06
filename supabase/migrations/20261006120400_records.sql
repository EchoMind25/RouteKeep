-- Application records, agreements, attachments.
-- PRD: FR-REC-01..05, FR-TEC-09, FR-MIG-05, CR-01..04, CR-11, DB-05, DB-08.
--
-- An application row is a self-contained legal record: every CR-01 field is
-- copied onto the row when it is written, so renaming a product, moving a
-- customer or a license renewal never rewrites history.

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  appointment_id uuid not null,
  product_id uuid,
  technician_id uuid,
  imported boolean not null default false,

  -- CR-01 snapshot
  customer_name text,
  customer_address text,
  application_address text,
  business_name text,
  business_address text,
  business_license_no text,
  applicator_name text,
  applicator_license_no text,
  product_name text,
  product_kind text check (product_kind in ('pesticide', 'minimum_risk', 'fertilizer', 'other')),
  epa_reg_no text,
  signal_word text check (signal_word in ('caution', 'warning', 'danger', 'danger_poison')),
  restricted_use boolean,
  mix_rate numeric(14, 6) check (mix_rate > 0),
  mix_unit text check (mix_unit in (
    'pct', 'fl_oz_per_gal', 'oz_per_gal', 'ml_per_l', 'g_per_l',
    'fl_oz_per_1000_sq_ft', 'oz_per_1000_sq_ft', 'lb_per_1000_sq_ft', 'lb_per_acre')),
  total_amount numeric(14, 6) check (total_amount > 0),
  amount_unit text check (amount_unit in ('fl_oz', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each')),
  area_treated numeric(14, 3) check (area_treated > 0),
  area_unit text check (area_unit in ('sq_ft', 'linear_ft', 'cu_ft', 'acre', 'each')),
  target_sites text[] not null default '{}',
  target_pests text[] not null default '{}',
  applied_at timestamptz,

  -- When the technician's device first saved it (offline), and when the server
  -- received it. DB-08's 24 hour lock runs from recorded_at, which the client
  -- cannot set.
  captured_at timestamptz,
  recorded_at timestamptz not null default now(),
  -- FR-REC-05: written customer statement before a restricted-use Danger product.
  customer_statement_at timestamptz,
  state_template text not null default 'UT' check (state_template ~ '^[A-Z]{2}$'),
  amended_from uuid,
  amendment_reason text,
  client_key text not null,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint applications_client_key unique (tenant_id, client_key),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id),
  foreign key (tenant_id, amended_from) references public.applications (tenant_id, id),

  -- G-04: a live record cannot exist without every field Utah R68-7-11(11) needs.
  constraint cr01_complete check (
    imported or (
      product_id is not null and technician_id is not null
      and customer_name is not null and customer_address is not null and application_address is not null
      and business_name is not null and business_address is not null and business_license_no is not null
      and applicator_name is not null and applicator_license_no is not null
      and product_name is not null and product_kind is not null
      and (product_kind <> 'pesticide' or epa_reg_no is not null)
      and mix_rate is not null and mix_unit is not null
      and total_amount is not null and amount_unit is not null
      and area_treated is not null and area_unit is not null
      and cardinality(target_sites) > 0 and cardinality(target_pests) > 0
      and applied_at is not null
    )
  ),
  constraint restricted_use_statement check (
    imported
    or not (coalesce(restricted_use, false) and signal_word in ('danger', 'danger_poison'))
    or customer_statement_at is not null
  ),
  constraint amendment_has_reason check (amended_from is null or amendment_reason is not null)
);
create index applications_appointment on public.applications (tenant_id, appointment_id);
create index applications_usage_report on public.applications (tenant_id, applied_at, product_id, technician_id);
create index applications_import_job on public.applications (tenant_id, import_job_id) where import_job_id is not null;

-- DB-08, FR-REC-03, FR-MIG-05, CR-04.
create or replace function app.guard_application() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if app.purge_allowed(old.tenant_id, old.import_job_id) then
      return old;
    end if;
    raise exception 'application records are retained and cannot be deleted' using errcode = '42501';
  end if;

  if old.imported then
    raise exception 'imported application history is read-only' using errcode = '42501';
  end if;
  if old.recorded_at < now() - interval '24 hours' then
    raise exception 'application record locked 24 hours after recording; create an amendment instead'
      using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id
     or new.client_key <> old.client_key
     or new.recorded_at <> old.recorded_at
     or new.imported <> old.imported
     or new.amended_from is distinct from old.amended_from then
    raise exception 'tenant_id, client_key, recorded_at, imported and amended_from are immutable'
      using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger guard_application_insert before insert on public.applications
  for each row execute function app.guard_application();
create trigger guard_application_change before update or delete on public.applications
  for each row execute function app.guard_application();

call app.secure_table('public.applications',
  p_select => '{*}', p_insert => '{*}', p_update => '{*}', p_delete => '{}');

-- Agreements (CR-11) -----------------------------------------------------------------

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  appointment_id uuid,
  document_type text not null check (document_type in ('service_agreement', 'restricted_use_statement', 'ach_authorization', 'other')),
  pdf_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  signer_name text not null check (length(btrim(signer_name)) > 0),
  signer_ip inet,
  signer_user_agent text,
  signed_at timestamptz not null,
  consent_text_version text not null,
  client_key text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, client_key),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id)
);
create index agreements_customer on public.agreements (tenant_id, customer_id);

create or replace function app.guard_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.purge_allowed(old.tenant_id) then
    return old;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end
$$;
create trigger guard_immutable before update or delete on public.agreements
  for each row execute function app.guard_immutable();

call app.secure_table('public.agreements',
  p_select => '{*}', p_insert => '{*}', p_update => '{}', p_delete => '{}');

-- Attachments (FR-TEC-09) ----------------------------------------------------------------
-- Files live in Supabase Storage under <tenant_id>/...; this row is the index.

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  owner_type text not null check (owner_type in ('appointment', 'application', 'customer', 'property', 'agreement', 'import_job', 'export')),
  owner_id uuid not null,
  kind text not null check (kind in ('photo', 'signature', 'document')),
  path text not null check (length(path) between 1 and 1024),
  content_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 26214400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz,
  uploaded_at timestamptz,
  client_key text not null default gen_random_uuid()::text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint attachments_client_key unique (tenant_id, client_key),
  unique (tenant_id, path)
);
create index attachments_owner on public.attachments (tenant_id, owner_type, owner_id);

call app.secure_table('public.attachments',
  p_select => '{*}', p_insert => '{*}', p_update => '{*}', p_delete => '{owner,admin}');

revoke all on all functions in schema app from public;
