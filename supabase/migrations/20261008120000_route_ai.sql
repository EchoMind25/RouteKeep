-- D-07 (revised 2026-10-07): the AI route planner. A dispatcher asks for a
-- plan; the run is queued here and advanced in short steps (D-04: a model that
-- reasons for a minute cannot run inside one request), each step a few model
-- turns. The last step writes the proposal; nothing changes on the route
-- until the dispatcher saves it.

alter table public.routes drop constraint routes_optimizer_check;
alter table public.routes add constraint routes_optimizer_check check (optimizer in ('google', 'vroom', 'manual', 'ai'));

create table public.route_ai_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  technician_id uuid not null,
  local_date date not null,
  -- ENG-01: a double click asks once.
  request_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- The lane as the dispatcher saw it; the proposal is only offered against it.
  expected jsonb not null check (jsonb_typeof(expected) = 'array'),
  -- Order, per-stop reasons, summary, and the measured before and after.
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error text,
  -- The conversation so far, replayed unchanged on the next step, and who
  -- holds the run: each step is a short request (D-04), never two at once.
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  lease_until timestamptz,
  model text,
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  requested_by uuid default auth.uid(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint route_ai_runs_request_key unique (tenant_id, request_key),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id)
);
create index route_ai_runs_lane on public.route_ai_runs (tenant_id, technician_id, local_date, created_at desc);

-- Dispatching roles ask and read; only the job (service role) writes results.
call app.secure_table('public.route_ai_runs',
  p_select => '{owner,admin,office,dispatcher}', p_insert => '{owner,admin,office,dispatcher}', p_update => '{}', p_delete => '{}');

revoke all on all functions in schema app from public;
