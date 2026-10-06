-- Customers and properties.
-- PRD: FR-CRM-01..04, DB-06, R-BUG-05 (geocode confidence and lockable pins).
--
-- Cross-tenant references are impossible by construction: every child row
-- points at its parent through (tenant_id, parent_id), so a row in tenant A can
-- never reference a row in tenant B even though foreign key checks bypass RLS.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  kind text not null default 'residential' check (kind in ('residential', 'commercial')),
  first_name text,
  last_name text,
  company_name text,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  alt_phone text check (alt_phone is null or alt_phone ~ '^\+[1-9][0-9]{7,14}$'),
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_region char(2) check (billing_region is null or billing_region ~ '^[A-Z]{2}$'),
  billing_postal_code text check (billing_postal_code is null or billing_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  -- FR-CRM-04, CR-07: SMS needs recorded consent with when and how it was given.
  sms_consent_at timestamptz,
  sms_consent_source text,
  sms_opted_out_at timestamptz,
  -- CR-08: marketing email is opt-in. Service email (reminders, invoices) is not
  -- marketing but still honours an unsubscribe (FR-MSG-04).
  email_opt_in boolean not null default false,
  email_opt_in_at timestamptz,
  email_unsubscribed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  stripe_customer_id text,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  search_text text generated always as (
    lower(display_name || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(company_name, ''))
  ) stored,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source, external_ref),
  constraint sms_consent_complete check ((sms_consent_at is null) = (sms_consent_source is null)),
  constraint email_opt_in_dated check (not email_opt_in or email_opt_in_at is not null)
);
create index customers_search on public.customers using gin (search_text extensions.gin_trgm_ops);
create index customers_name on public.customers (tenant_id, lower(display_name));
create index customers_import_job on public.customers (tenant_id, import_job_id) where import_job_id is not null;

call app.secure_table('public.customers',
  p_select => '{*}',
  p_insert => '{owner,admin,office,dispatcher}',
  p_update => '{owner,admin,office,dispatcher}',
  p_delete => '{owner,admin}');
call app.add_version_trigger('public.customers');

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  label text,
  address_line1 text not null check (length(btrim(address_line1)) > 0),
  address_line2 text,
  city text not null check (length(btrim(city)) > 0),
  region char(2) not null check (region ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  location extensions.geography(Point, 4326),
  geocode_confidence numeric(4, 3) check (geocode_confidence between 0 and 1),
  geocode_source text,
  geocoded_at timestamptz,
  location_confirmed_at timestamptz,
  location_confirmed_by uuid,
  location_locked boolean not null default false,
  access_notes text,
  sq_ft integer check (sq_ft > 0),
  lawn_area_sq_ft integer check (lawn_area_sq_ft > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, customer_id, id),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  constraint locked_pin_has_location check (not location_locked or location is not null)
);
create index properties_customer on public.properties (tenant_id, customer_id);
create index properties_location on public.properties using gist (location);
create index properties_import_job on public.properties (tenant_id, import_job_id) where import_job_id is not null;

-- R-BUG-05: a confirmed, locked pin is never moved by a re-geocode or an
-- import. Moving it means unlocking it in the same update, on purpose.
create or replace function app.guard_locked_pin() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.location_locked and new.location_locked
     and new.location is distinct from old.location then
    raise exception 'property pin is locked; unlock it before moving it' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger guard_locked_pin before update on public.properties
  for each row execute function app.guard_locked_pin();

call app.secure_table('public.properties',
  p_select => '{*}',
  p_insert => '{owner,admin,office,dispatcher}',
  p_update => '{owner,admin,office,dispatcher}',
  p_delete => '{owner,admin}');
call app.add_version_trigger('public.properties');

-- New functions get EXECUTE for PUBLIC by default; take it back. Explicit grants
-- to authenticated made in earlier migrations are unaffected.
revoke all on all functions in schema app from public;
