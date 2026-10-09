-- Product analytics (OPS-03, OPS-04): anonymous product events and error
-- reports, so RouteVerde can see what breaks and which auto routes people
-- refuse, and a per-business data-sharing setting that gates every event.
-- Contract: docs/DATA_COLLECTION.md.
--
-- Platform data, not tenant data: like app.operator_audit, the events live in
-- the private app schema, outside secure_table and out of reach of every API
-- role. The only way in is app.track_event, which reads the business's setting
-- at insert time; the only way out is the app.ops_product_* functions.

-- OPS-04: none = nothing stored; anonymous = stored with no business id;
-- identified = stored with the business id. Never a person, at any level.
alter table public.tenants
  add column data_sharing text not null default 'anonymous'
    check (data_sharing in ('none', 'anonymous', 'identified')),
  add column data_sharing_changed_at timestamptz;
comment on column public.tenants.data_sharing is 'OPS-04: product analytics level. none stores nothing; anonymous stores events with no business id; identified adds the business id.';
-- Owners and admins only, by the existing tenant_self_update policy. The change
-- itself lands in public.audit_log through the tenants audit trigger.
grant update (data_sharing) on table public.tenants to authenticated;

create table app.product_events (
  id bigint generated always as identity primary key,
  -- No exact timestamps: an hour is enough to see trends and hides who did what when.
  hour timestamptz not null,
  name text not null check (name ~ '^[a-z][a-z_]{1,30}(\.[a-z][a-z_]{1,40}){1,2}$'),
  surface text not null check (surface in ('office', 'tech', 'portal', 'public', 'server', 'job')),
  -- Set only while the business is at `identified`. A deleted business takes its rows with it.
  tenant_id uuid references public.tenants (id) on delete cascade,
  app_version text check (app_version is null or app_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  props jsonb not null default '{}'::jsonb
    check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 2048)
);
-- The console reads by time window, by event name over a window, and the
-- setting trigger finds a business's rows; nothing else queries this table.
create index product_events_hour on app.product_events (hour desc);
create index product_events_name_hour on app.product_events (name, hour desc);
create index product_events_tenant on app.product_events (tenant_id) where tenant_id is not null;
revoke all on app.product_events from public, anon, authenticated, portal, platform_operator;

-- Props are flat: numbers, booleans and short strings. Nested objects and
-- arrays would be a way to smuggle records in, so they are refused.
create or replace function app.valid_event_props(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and pg_column_size(p) <= 2048
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key !~ '^[a-z][a-z0-9_]{0,39}$'
         or jsonb_typeof(e.value) not in ('number', 'boolean', 'string')
         or (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 200)
    )
$$;

-- The one gate (OPS-04). The business comes from who is calling, never from an
-- argument, except for jobs running as service_role. Returns whether a row was stored.
create or replace function app.track_event(
  p_name text,
  p_props jsonb default '{}'::jsonb,
  p_surface text default 'server',
  p_app_version text default null,
  p_tenant uuid default null
) returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role text := current_setting('role', true);
  v_tenant uuid;
  v_level text;
begin
  if v_role is null or v_role = 'none' then
    v_role := session_user;
  end if;
  v_tenant := case v_role
    when 'authenticated' then app.current_tenant_id()
    -- app.portal_tenant_id() checks current_user, which is this function's owner here.
    when 'portal' then nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'portal_tenant_id', '')::uuid
    when 'service_role' then p_tenant
    else null
  end;

  if v_tenant is null then
    -- No business behind the call (public site, signed-out page): error reports only.
    if p_name !~ '^error\.' then
      return false;
    end if;
    v_level := 'anonymous';
  else
    select t.data_sharing into v_level from public.tenants t where t.id = v_tenant;
    if v_level is null or v_level = 'none' then
      return false;
    end if;
  end if;

  if not app.valid_event_props(coalesce(p_props, '{}'::jsonb)) then
    raise exception 'event props must be a flat object of short values' using errcode = '22023';
  end if;

  insert into app.product_events (hour, name, surface, tenant_id, app_version, props)
  values (
    date_trunc('hour', now()),
    p_name,
    p_surface,
    case when v_level = 'identified' then v_tenant end,
    p_app_version,
    coalesce(p_props, '{}'::jsonb)
  );
  return true;
end
$$;

-- OPS-04: lowering the level applies to the past too. To none: the business's
-- identified rows are deleted. To anonymous: the business id is removed from
-- them. Anonymous rows were never linked, so there is nothing to find.
create or replace function app.apply_data_sharing() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.data_sharing is distinct from old.data_sharing then
    new.data_sharing_changed_at := now();
    if new.data_sharing = 'none' then
      delete from app.product_events where tenant_id = new.id;
    elsif new.data_sharing = 'anonymous' then
      update app.product_events set tenant_id = null where tenant_id = new.id;
    end if;
  end if;
  return new;
end
$$;
create trigger apply_data_sharing before update of data_sharing on public.tenants
  for each row execute function app.apply_data_sharing();

-- Retention: raw events are kept 180 days (docs/DATA_COLLECTION.md). Deletes
-- in batches so a large backlog never holds one long transaction.
create or replace function app.purge_product_events(p_keep_days integer default 180, p_batch integer default 50000) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from app.product_events
  where id in (
    select id from app.product_events
    where hour < date_trunc('hour', now()) - make_interval(days => greatest(p_keep_days, 1))
    order by hour
    limit greatest(p_batch, 1)
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

-- Developer console (OPS-01, OPS-03): counts and rates only. A business name
-- appears only next to rows its owner chose to share as `identified`.
create or replace function app.ops_product_summary(p_days integer default 30) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with w as (
    select * from app.product_events
    where hour >= date_trunc('hour', now()) - make_interval(days => least(greatest(p_days, 1), 180))
  )
  select jsonb_build_object(
    'days', least(greatest(p_days, 1), 180),
    'sharing', (
      select jsonb_build_object(
        'none', count(*) filter (where data_sharing = 'none'),
        'anonymous', count(*) filter (where data_sharing = 'anonymous'),
        'identified', count(*) filter (where data_sharing = 'identified')
      )
      from public.tenants
    ),
    'events', coalesce((select jsonb_object_agg(name, n) from (select name, count(*) as n from w group by name) x), '{}'::jsonb),
    'errors_by_surface', coalesce((
      select jsonb_object_agg(surface, n)
      from (select surface, count(*) as n from w where name like 'error.%' group by surface) x
    ), '{}'::jsonb),
    'errors_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'count', n) order by day)
      from (select (hour at time zone 'UTC')::date as day, count(*) as n from w where name like 'error.%' group by 1) x
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_object_agg(engine, counts)
      from (
        select coalesce(props ->> 'engine', 'unknown') as engine,
          jsonb_build_object(
            'shown', count(*) filter (where name = 'route.proposal_shown'),
            'accepted', count(*) filter (where name = 'route.proposal_accepted'),
            'dismissed', count(*) filter (where name = 'route.proposal_dismissed'),
            'undone', count(*) filter (where name = 'route.proposal_undone'),
            'manual_change', count(*) filter (where name = 'route.manual_change_after_optimize')
          ) as counts
        from w
        where name in ('route.proposal_shown', 'route.proposal_accepted', 'route.proposal_dismissed',
                       'route.proposal_undone', 'route.manual_change_after_optimize')
        group by 1
      ) x
    ), '{}'::jsonb),
    'out_of_order', (
      select jsonb_build_object(
        'stops', count(*),
        'avg_jump', coalesce(round(avg(abs((props ->> 'actual_position')::numeric - (props ->> 'published_position')::numeric)), 1), 0)
      )
      from w where name = 'route.stop_out_of_order'
    ),
    'identified', coalesce((
      select jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'name', t.name, 'events', x.n, 'errors', x.e) order by x.e desc, x.n desc)
      from (
        select tenant_id, count(*) as n, count(*) filter (where name like 'error.%') as e
        from w where tenant_id is not null group by tenant_id order by 3 desc, 2 desc limit 20
      ) x
      join public.tenants t on t.id = x.tenant_id
    ), '[]'::jsonb)
  )
$$;

-- Errors grouped by fingerprint, most frequent first.
create or replace function app.ops_product_errors(p_days integer default 7, p_limit integer default 50) returns table (
  fingerprint text,
  name text,
  surface text,
  kind text,
  route text,
  message text,
  occurrences integer,
  first_hour timestamptz,
  last_hour timestamptz,
  versions text[],
  businesses text[]
)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce(e.props ->> 'fingerprint', 'none'),
    e.name,
    e.surface,
    max(e.props ->> 'kind'),
    max(e.props ->> 'route'),
    max(e.props ->> 'message'),
    count(*)::int,
    min(e.hour),
    max(e.hour),
    (array_agg(distinct e.app_version) filter (where e.app_version is not null))[1:5],
    (array_agg(distinct t.name) filter (where t.name is not null))[1:5]
  from app.product_events e
  left join public.tenants t on t.id = e.tenant_id
  where e.name like 'error.%'
    and e.hour >= date_trunc('hour', now()) - make_interval(days => least(greatest(p_days, 1), 180))
  group by 1, 2, 3
  order by count(*) desc, max(e.hour) desc
  limit least(greatest(p_limit, 1), 200)
$$;

revoke all on function
  app.valid_event_props(jsonb),
  app.track_event(text, jsonb, text, text, uuid),
  app.apply_data_sharing(),
  app.purge_product_events(integer, integer),
  app.ops_product_summary(integer),
  app.ops_product_errors(integer, integer)
from public;
grant execute on function app.track_event(text, jsonb, text, text, uuid) to anon, authenticated, portal, service_role;
grant execute on function app.purge_product_events(integer, integer) to service_role;
grant execute on function app.ops_product_summary(integer), app.ops_product_errors(integer, integer) to platform_operator;
