-- "Running late" (FR-TEC-02, FR-DSP-05, FR-MSG-01, ENG-01): a technician tells
-- the office and the day's remaining customers they are behind. One row per
-- tap, append-only; the board shows the newest for each technician and day.
create table public.tech_day_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  technician_id uuid not null,
  local_date date not null,
  kind text not null check (kind in ('running_late')),
  delay_min integer not null check (delay_min between 5 and 240),
  -- ENG-01: the phone sends it until the server answers; it is stored once.
  client_key text not null check (length(client_key) between 8 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint tech_day_notices_client_key unique (tenant_id, client_key),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id)
);
create index tech_day_notices_lane on public.tech_day_notices (tenant_id, local_date, technician_id, created_at desc);

-- Any member's upload may add one (a technician is a member) and any member may read them.
call app.secure_table('public.tech_day_notices',
  p_select => '{*}', p_insert => '{*}', p_update => '{}', p_delete => '{}');

revoke all on all functions in schema app from public;
