-- Catalog and scheduling: service types, plans, products, subscriptions,
-- appointments, routes.
-- PRD: FR-SET-03, FR-SET-04, FR-SUB-01..04, FR-DSP-02..05, FR-MIG-15, DB-05, DB-06,
-- ENG-05 (local date + local time + IANA zone), ENG-06 (cents), ENG-07 (version).

-- Service types ------------------------------------------------------------------

create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  category text not null check (category in ('pest', 'lawn', 'termite', 'mosquito')),
  default_duration_min integer not null default 30 check (default_duration_min between 5 and 600),
  -- FR-TEC-03: the checklist step of the stop flow. Array of {"label": text}.
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index service_types_name on public.service_types (tenant_id, lower(name));

call app.secure_table('public.service_types',
  p_select => '{*}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Every new tenant starts with one service type per category so the first plan
-- can be created without a detour (FR-SET-01 accept: usable in under 10 minutes).
create or replace function app.seed_tenant_defaults() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.service_types (tenant_id, name, category, default_duration_min, checklist)
  values
    (new.id, 'General pest', 'pest', 30,
     '[{"label":"Walk the exterior perimeter"},{"label":"Treat entry points and foundation"},{"label":"Remove webs and nests within reach"},{"label":"Note conducive conditions for the customer"}]'),
    (new.id, 'Lawn treatment', 'lawn', 25,
     '[{"label":"Check for pets, kids and open windows"},{"label":"Measure treated area"},{"label":"Place lawn flags at entry points"}]'),
    (new.id, 'Termite inspection', 'termite', 45,
     '[{"label":"Inspect foundation and crawlspace"},{"label":"Check wood-to-soil contact"},{"label":"Record findings for the customer"}]'),
    (new.id, 'Mosquito treatment', 'mosquito', 30,
     '[{"label":"Dump standing water"},{"label":"Treat shaded vegetation and resting sites"}]');
  return new;
end
$$;
create trigger seed_tenant_defaults after insert on public.tenants
  for each row execute function app.seed_tenant_defaults();

-- Service plans (FR-SET-04) ----------------------------------------------------------
-- rrule holds the recurrence without DTSTART (the subscription supplies the
-- start date), for example FREQ=MONTHLY;INTERVAL=3 or FREQ=YEARLY;BYMONTH=4,6,8,10.

create table public.service_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  service_type_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  price_cents integer not null check (price_cents >= 0),
  initial_price_cents integer check (initial_price_cents >= 0),
  rrule text not null check (rrule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[-+A-Z0-9,]+)*$'),
  billing_mode text not null default 'per_service'
    check (billing_mode in ('per_service', 'monthly', 'quarterly', 'annually')),
  default_duration_min integer check (default_duration_min between 5 and 600),
  active boolean not null default true,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id)
);
create index service_plans_type on public.service_plans (tenant_id, service_type_id);

call app.secure_table('public.service_plans',
  p_select => '{*}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Products (FR-SET-03) -------------------------------------------------------------
-- kind 'minimum_risk' covers FIFRA 25(b) products, which carry no EPA
-- registration number. Unit codes match lib/domain/units.ts.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  kind text not null default 'pesticide' check (kind in ('pesticide', 'minimum_risk', 'fertilizer', 'other')),
  epa_reg_no text check (epa_reg_no is null or epa_reg_no ~ '^[0-9]{1,7}-[0-9]{1,6}(-[0-9]{1,7})?$'),
  signal_word text check (signal_word in ('caution', 'warning', 'danger', 'danger_poison')),
  restricted_use boolean not null default false,
  active_ingredients text,
  default_amount_unit text check (default_amount_unit in ('fl_oz', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each')),
  default_mix_rate numeric(14, 6) check (default_mix_rate > 0),
  default_mix_unit text check (default_mix_unit in (
    'pct', 'fl_oz_per_gal', 'oz_per_gal', 'ml_per_l', 'g_per_l',
    'fl_oz_per_1000_sq_ft', 'oz_per_1000_sq_ft', 'lb_per_1000_sq_ft', 'lb_per_acre')),
  active boolean not null default true,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source, external_ref),
  constraint pesticide_has_epa_no check (kind <> 'pesticide' or epa_reg_no is not null),
  constraint mix_rate_has_unit check ((default_mix_rate is null) = (default_mix_unit is null))
);
create index products_name on public.products (tenant_id, lower(name));

call app.secure_table('public.products',
  p_select => '{*}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Subscriptions (FR-SUB-01, FR-SUB-03) -----------------------------------------------
-- Price, recurrence and billing mode are copied from the plan at sale time so a
-- later plan edit never silently changes what an existing customer pays.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  property_id uuid not null,
  plan_id uuid not null,
  service_type_id uuid not null,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  start_date date not null,
  rrule text not null check (rrule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[-+A-Z0-9,]+)*$'),
  price_cents integer not null check (price_cents >= 0),
  initial_price_cents integer check (initial_price_cents >= 0),
  billing_mode text not null check (billing_mode in ('per_service', 'monthly', 'quarterly', 'annually')),
  duration_min integer not null default 30 check (duration_min between 5 and 600),
  autopay boolean not null default false,
  preferred_technician_id uuid,
  preferred_window_start time,
  preferred_window_end time,
  paused_from date,
  paused_until date,
  pause_reason text,
  cancelled_at timestamptz,
  cancel_reason text,
  -- FR-SUB-02: appointments exist for every occurrence up to this date.
  generated_through date,
  -- Imports: the next visit the old system had on file (FR-MIG-04).
  next_service_date date,
  notes text,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, id, property_id),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, customer_id, property_id) references public.properties (tenant_id, customer_id, id),
  foreign key (tenant_id, plan_id) references public.service_plans (tenant_id, id),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id),
  foreign key (tenant_id, preferred_technician_id) references public.technicians (tenant_id, id),
  constraint cancelled_is_dated check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint cancelled_has_reason check (status <> 'cancelled' or cancel_reason is not null),
  constraint paused_has_start check (status <> 'paused' or paused_from is not null),
  constraint pause_range check (paused_until is null or paused_from is null or paused_until >= paused_from),
  constraint preferred_window check (
    preferred_window_start is null or preferred_window_end is null or preferred_window_end > preferred_window_start)
);
create index subscriptions_customer on public.subscriptions (tenant_id, customer_id);
create index subscriptions_generation on public.subscriptions (tenant_id, generated_through) where status = 'active';
create index subscriptions_import_job on public.subscriptions (tenant_id, import_job_id) where import_job_id is not null;

call app.secure_table('public.subscriptions',
  p_select => '{*}',
  p_insert => '{owner,admin,office}',
  p_update => '{owner,admin,office}',
  p_delete => '{}');
call app.add_version_trigger('public.subscriptions');

-- Technicians and the office both edit this table, so it is versioned.
call app.add_version_trigger('public.technicians');

-- Appointments ----------------------------------------------------------------------
-- local_date + window + tz is what a human scheduled (ENG-05). occurrence_date is
-- the recurrence date the row was generated for; it never changes when the visit
-- is moved, which is what makes regeneration idempotent (FR-SUB-02).

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  property_id uuid not null,
  subscription_id uuid,
  service_type_id uuid not null,
  technician_id uuid,
  status text not null default 'scheduled'
    check (status in ('unscheduled', 'scheduled', 'in_progress', 'completed', 'skipped', 'cancelled')),
  local_date date,
  window_start time,
  window_end time,
  tz text not null references app.iana_zones (name),
  duration_min integer not null default 30 check (duration_min between 5 and 600),
  -- FR-DSP-05: the one stop number shown on the map, the list and the tech app.
  sequence integer check (sequence > 0),
  occurrence_date date,
  is_initial boolean not null default false,
  -- Edited on its own ("this visit only"); series edits leave it alone.
  detached boolean not null default false,
  price_cents integer check (price_cents >= 0),
  -- FR-MIG-15: parallel-run rows never message or charge anyone.
  shadow boolean not null default false,
  skip_reason text,
  cancel_reason text,
  en_route_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  notes text,
  client_key text not null default gen_random_uuid()::text,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint appointments_client_key unique (tenant_id, client_key),
  constraint appointments_occurrence unique (tenant_id, subscription_id, occurrence_date),
  unique (tenant_id, source, external_ref),
  foreign key (tenant_id, customer_id, property_id) references public.properties (tenant_id, customer_id, id),
  foreign key (tenant_id, subscription_id, property_id) references public.subscriptions (tenant_id, id, property_id),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id),
  constraint unscheduled_has_no_date check ((status = 'unscheduled') = (local_date is null)),
  constraint window_order check (window_start is null or window_end is null or window_end > window_start),
  constraint skipped_has_reason check (status <> 'skipped' or skip_reason is not null),
  constraint cancelled_has_reason check (status <> 'cancelled' or cancel_reason is not null),
  constraint completed_is_dated check (status <> 'completed' or completed_at is not null),
  constraint generated_has_occurrence check (subscription_id is null or occurrence_date is not null or not is_initial)
);
create index appointments_day on public.appointments (tenant_id, local_date, technician_id, sequence);
create index appointments_subscription on public.appointments (tenant_id, subscription_id, local_date);
create index appointments_property on public.appointments (tenant_id, property_id, local_date);
create index appointments_queue on public.appointments (tenant_id, local_date)
  where status in ('unscheduled', 'skipped', 'cancelled') or (technician_id is null and status = 'scheduled');
create index appointments_import_job on public.appointments (tenant_id, import_job_id) where import_job_id is not null;

call app.secure_table('public.appointments',
  p_select => '{*}',
  p_insert => '{*}',
  p_update => '{*}',
  p_delete => '{owner,admin,office,dispatcher}');
call app.add_version_trigger('public.appointments');

-- Routes (FR-DSP-03) --------------------------------------------------------------------
-- One row per technician per day. previous_order holds the order before the
-- last optimize commit so it can be undone.

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  technician_id uuid not null,
  local_date date not null,
  optimizer text check (optimizer in ('google', 'vroom', 'manual')),
  optimized_at timestamptz,
  run_id text,
  published_at timestamptz,
  previous_order jsonb check (previous_order is null or jsonb_typeof(previous_order) = 'array'),
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, technician_id, local_date),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id)
);

call app.secure_table('public.routes',
  p_select => '{*}',
  p_insert => '{owner,admin,office,dispatcher}',
  p_update => '{owner,admin,office,dispatcher}',
  p_delete => '{owner,admin,office,dispatcher}');
call app.add_version_trigger('public.routes');

revoke all on all functions in schema app from public;
