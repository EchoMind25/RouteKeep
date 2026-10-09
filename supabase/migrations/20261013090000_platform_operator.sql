-- Developer console (OPS-01): a platform-level, read-only view across every
-- business, for the people who run RouteVerde itself.
--
-- Who counts as a developer is decided in the app (DEVELOPER_EMAILS, a verified
-- email, and a second factor; lib/auth/developer.ts). The database adds the
-- limit on what that session can do: it runs as `platform_operator`, a role with
-- no table privileges at all. It can only call the functions in this file, which
-- return counts, statuses and system error text. No customer names, addresses,
-- emails, phone numbers or message bodies leave through here, so a bug in the
-- console cannot turn into a customer data leak.
--
-- Platform data, not tenant data: the audit table has no tenant_id and lives in
-- the private app schema (like app.rate_limits), outside secure_table and out of
-- reach of every API role.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_operator') then
    create role platform_operator nologin noinherit;
  end if;
end
$$;
-- The connection user switches to it, as it does to `authenticated` and `portal`.
do $$ begin execute format('grant platform_operator to %I', current_user); end $$;
grant usage on schema app to platform_operator;

-- Every developer action, append-only (OPS-02).
create table app.operator_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text not null,
  action text not null check (action ~ '^[a-z][a-z_.]{2,63}$'),
  target_tenant_id uuid references public.tenants (id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  at timestamptz not null default now()
);
create index operator_audit_at on app.operator_audit (at desc);
create index operator_audit_target on app.operator_audit (target_tenant_id) where target_tenant_id is not null;
revoke all on app.operator_audit from public, anon, authenticated, portal, platform_operator;

-- A tenant purge may null the target; nothing else may change or remove a row.
create or replace function app.guard_operator_audit() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.target_tenant_id is not null and new.target_tenant_id is null
     and (to_jsonb(new) - 'target_tenant_id') = (to_jsonb(old) - 'target_tenant_id') then
    return new;
  end if;
  raise exception 'operator_audit rows are append-only' using errcode = '42501';
end
$$;
create trigger guard_immutable before update or delete on app.operator_audit
  for each row execute function app.guard_operator_audit();

-- The caller's identity comes from the claims withOperator set, never from arguments.
create or replace function app.ops_record(p_action text, p_target uuid default null, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if v_claims is null or (v_claims ->> 'sub') is null or coalesce(v_claims ->> 'email', '') = '' then
    raise exception 'operator identity missing' using errcode = '42501';
  end if;
  insert into app.operator_audit (actor_id, actor_email, action, target_tenant_id, details)
  values ((v_claims ->> 'sub')::uuid, lower(v_claims ->> 'email'), p_action, p_target, coalesce(p_details, '{}'::jsonb));
end
$$;

-- One row per business: size against plan (D-11), setup state and what is wrong right now.
create or replace function app.ops_tenants() returns table (
  tenant_id uuid,
  name text,
  plan text,
  state text,
  created_at timestamptz,
  members integer,
  active_customers integer,
  visits_completed_30d integer,
  stripe_charges_enabled boolean,
  white_label boolean,
  messaging_live boolean,
  open_reconciliation integer,
  stuck_payments integer,
  failed_payments_7d integer,
  failed_messages_7d integer,
  open_sync_conflicts integer,
  last_billing_run timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select
    t.id, t.name, t.plan, t.state, t.created_at,
    (select count(*)::int from public.memberships m where m.tenant_id = t.id),
    (select count(*)::int from public.customers c where c.tenant_id = t.id and c.status = 'active'),
    (select count(*)::int from public.appointments a
      where a.tenant_id = t.id and a.local_date >= current_date - 30 and a.status = 'completed'),
    t.stripe_charges_enabled,
    t.white_label_at is not null,
    t.messaging_live_at is not null,
    (select count(*)::int from public.reconciliation_issues r where r.tenant_id = t.id and r.resolved_at is null),
    (select count(*)::int from public.payments p
      where p.tenant_id = t.id and p.status in ('pending', 'processing')
        and p.method in ('card', 'ach', 'card_on_file') and p.created_at < now() - interval '24 hours'),
    (select count(*)::int from public.payments p
      where p.tenant_id = t.id and p.status = 'failed' and p.created_at >= now() - interval '7 days'),
    (select count(*)::int from public.messages g
      where g.tenant_id = t.id and g.status in ('failed', 'bounced') and g.created_at >= now() - interval '7 days'),
    (select count(*)::int from public.sync_conflicts s where s.tenant_id = t.id and s.resolved_at is null),
    (select max(b.finished_at) from public.billing_runs b where b.tenant_id = t.id)
  from public.tenants t
  order by t.created_at desc
$$;

-- Platform-wide queues and job health, as one object.
create or replace function app.ops_health() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'checked_at', now(),
    'tenants', (select count(*) from public.tenants),
    'tenants_new_30d', (select count(*) from public.tenants where created_at >= now() - interval '30 days'),
    'active_customers', (select count(*) from public.customers where status = 'active'),
    'outbox', (
      select jsonb_build_object(
        'pending', count(*),
        'retrying', count(*) filter (where attempts > 0),
        'oldest_pending_at', min(available_at)
      )
      from public.outbox_events where sent_at is null
    ),
    'messages_24h', (
      select jsonb_build_object(
        'sent', count(*) filter (where status in ('sent', 'delivered')),
        'failed', count(*) filter (where status in ('failed', 'bounced')),
        'suppressed', count(*) filter (where status = 'suppressed')
      )
      from public.messages where created_at >= now() - interval '24 hours'
    ),
    'webhooks', (
      select jsonb_build_object(
        'unprocessed', count(*) filter (where processed_at is null),
        'unprocessed_over_5m', count(*) filter (where processed_at is null and received_at < now() - interval '5 minutes'),
        'errors_24h', count(*) filter (where error is not null and received_at >= now() - interval '24 hours')
      )
      from public.webhook_events where processed_at is null or received_at >= now() - interval '24 hours'
    ),
    'payments', (
      select jsonb_build_object(
        'succeeded_30d', count(*) filter (where status = 'succeeded' and created_at >= now() - interval '30 days'),
        'succeeded_cents_30d', coalesce(sum(amount_cents) filter (where status = 'succeeded' and created_at >= now() - interval '30 days'), 0),
        'failed_7d', count(*) filter (where status = 'failed' and created_at >= now() - interval '7 days'),
        'stuck', count(*) filter (where status in ('pending', 'processing') and method in ('card', 'ach', 'card_on_file') and created_at < now() - interval '24 hours')
      )
      from public.payments
      where created_at >= now() - interval '30 days' or status in ('pending', 'processing')
    ),
    'reconciliation_open', (select count(*) from public.reconciliation_issues where resolved_at is null),
    'billing', (
      select jsonb_build_object(
        'last_finished_at', max(finished_at),
        'unfinished_over_1h', count(*) filter (where finished_at is null and started_at < now() - interval '1 hour'),
        'runs_with_failures_7d', count(*) filter (where started_at >= now() - interval '7 days' and jsonb_typeof(failures) = 'array' and jsonb_array_length(failures) > 0)
      )
      from public.billing_runs where started_at >= now() - interval '7 days' or finished_at is null
    ),
    'imports', (
      select jsonb_build_object(
        'in_progress', count(*) filter (where status in ('validating', 'committing', 'rolling_back')),
        'failed_7d', count(*) filter (where status = 'failed' and updated_at >= now() - interval '7 days')
      )
      from public.import_jobs where status in ('validating', 'committing', 'rolling_back', 'failed')
    ),
    'exports', (
      select jsonb_build_object(
        'in_progress', count(*) filter (where status in ('queued', 'running')),
        'failed_7d', count(*) filter (where status = 'failed' and updated_at >= now() - interval '7 days')
      )
      from public.exports where status in ('queued', 'running', 'failed')
    ),
    'route_ai', (
      select jsonb_build_object(
        'runs_7d', count(*),
        'failed_7d', count(*) filter (where status = 'failed')
      )
      from public.route_ai_runs where created_at >= now() - interval '7 days'
    ),
    'sync_conflicts_open', (select count(*) from public.sync_conflicts where resolved_at is null)
  )
$$;

-- System failures with their error text. Customer messages are left out on
-- purpose: a provider's error can quote the recipient's address.
create or replace function app.ops_recent_errors(p_limit integer default 50) returns table (
  at timestamptz,
  source text,
  kind text,
  tenant_id uuid,
  tenant_name text,
  error text
)
language sql stable security definer set search_path = ''
as $$
  select e.at, e.source, e.kind, e.tenant_id, t.name, left(e.error, 300)
  from (
    (select w.received_at as at, 'webhook'::text as source, w.provider || ' ' || w.type as kind, w.tenant_id, w.error
     from public.webhook_events w
     where w.error is not null and w.received_at >= now() - interval '7 days'
     order by w.received_at desc limit p_limit)
    union all
    (select x.updated_at, 'export', 'export', x.tenant_id, coalesce(x.error, 'failed')
     from public.exports x
     where x.status = 'failed' and x.updated_at >= now() - interval '7 days'
     order by x.updated_at desc limit p_limit)
    union all
    (select j.updated_at, 'import', j.source, j.tenant_id, coalesce(j.error, 'failed')
     from public.import_jobs j
     where j.status = 'failed' and j.updated_at >= now() - interval '7 days'
     order by j.updated_at desc limit p_limit)
    union all
    (select r.updated_at, 'route_ai', coalesce(r.model, 'route planner'), r.tenant_id, coalesce(r.error, 'failed')
     from public.route_ai_runs r
     where r.status = 'failed' and r.created_at >= now() - interval '7 days'
     order by r.updated_at desc limit p_limit)
    union all
    (select r.found_at, 'reconciliation', r.kind, r.tenant_id, r.details
     from public.reconciliation_issues r
     where r.resolved_at is null
     order by r.found_at desc limit p_limit)
  ) e
  left join public.tenants t on t.id = e.tenant_id
  order by e.at desc
  limit least(greatest(p_limit, 1), 200)
$$;

create or replace function app.ops_audit_recent(p_limit integer default 25) returns table (
  at timestamptz,
  actor_email text,
  action text,
  target_tenant_id uuid,
  details jsonb
)
language sql stable security definer set search_path = ''
as $$
  select a.at, a.actor_email, a.action, a.target_tenant_id, a.details
  from app.operator_audit a
  order by a.at desc
  limit least(greatest(p_limit, 1), 200)
$$;

revoke all on function
  app.ops_record(text, uuid, jsonb), app.ops_tenants(), app.ops_health(),
  app.ops_recent_errors(integer), app.ops_audit_recent(integer), app.guard_operator_audit()
from public;
grant execute on function
  app.ops_record(text, uuid, jsonb), app.ops_tenants(), app.ops_health(),
  app.ops_recent_errors(integer), app.ops_audit_recent(integer)
to platform_operator;
