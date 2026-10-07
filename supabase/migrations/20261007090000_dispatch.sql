-- Dispatch (M2): route start points, route-level ordering, publishing.
-- PRD: FR-DSP-01..06, ENG-07.

-- Where each technician's day starts. Optional; without it a route starts at
-- its first stop.
alter table public.offices add column location extensions.geography(Point, 4326);

-- Stop order belongs to the route. Board writes lock the route row and check
-- the lane's current order against the order the dispatcher saw (FR-DSP-02),
-- so reordering a route must not invalidate a visit form someone has open:
-- `sequence` joins the bookkeeping columns that do not bump appointments.version.
create or replace function app.bump_version() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignored text[] := array['version', 'updated_at', 'generated_through', 'sequence'];
begin
  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end
$$;

-- published_order is the stop order the technician was given; when the lane
-- no longer matches it, the board says the route changed since publishing.
-- FR-DSP-06: flagged_stops is how many long-leg warnings the dispatcher
-- published through.
alter table public.routes add column published_by uuid;
alter table public.routes add column published_order jsonb
  check (published_order is null or jsonb_typeof(published_order) = 'array');
alter table public.routes add column flagged_stops integer not null default 0 check (flagged_stops >= 0);

revoke all on all functions in schema app from public;
