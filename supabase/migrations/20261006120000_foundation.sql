-- Foundation: extensions, the private `app` schema, shared trigger functions,
-- and the procedure every tenant table is secured with.
-- PRD: section 7, ENG-05 (time zones), ENG-07 (version), ENG-08 (tenant isolation), CR-10.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Private schema. Not listed in the Data API's exposed schemas, so nothing in
-- it is reachable over HTTP. Policies call into it, so `authenticated` gets
-- USAGE and EXECUTE on the specific functions policies need, nothing more.
create schema if not exists app;
comment on schema app is 'Private helpers for RLS, triggers and invariants. Never exposed through the Data API.';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ENG-05: every human-scheduled thing stores an IANA zone. A foreign key to
-- this table rejects anything else at index-lookup cost. Only region-qualified
-- names (America/Denver) and UTC are allowed: legacy names such as MST,
-- MST7MDT, US/Mountain or Etc/GMT+7 are fixed offsets or aliases in disguise,
-- and MST in particular never observes daylight saving time.
create table app.iana_zones (
  name text primary key
);
insert into app.iana_zones (name)
select name
from pg_catalog.pg_timezone_names
where name ~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z_+-]+(/[A-Za-z_+-]+)?$'
   or name = 'UTC'
on conflict do nothing;
grant select on app.iana_zones to authenticated, service_role;

-- Shared trigger functions ------------------------------------------------------

create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ENG-07: optimistic concurrency. Writers update with `where version = <seen>`;
-- the database owns the counter so a client can never rewind it. Bookkeeping
-- columns written by jobs (generated_through) and no-op updates do not count
-- as edits, so the nightly generator never invalidates a form someone has open.
create or replace function app.bump_version() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignored text[] := array['version', 'updated_at', 'generated_through'];
begin
  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end
$$;

-- Escape hatch for the two legitimate ways append-only rows disappear:
-- a full tenant purge and an import rollback (FR-MIG-14). Only privileged
-- roles may use it; `authenticated` cannot, whatever settings it sets.
create or replace function app.purge_allowed(p_tenant_id uuid, p_import_job_id uuid default null) returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon')
     and (
       coalesce(current_setting('app.purge_tenant_id', true), '') = p_tenant_id::text
       or (
         p_import_job_id is not null
         and coalesce(current_setting('app.rollback_import_job_id', true), '') = p_import_job_id::text
       )
     )
$$;

-- Table security ----------------------------------------------------------------
-- Every tenant table goes through this procedure, so no table can be created
-- with default grants. Role lists: '{*}' means any active member of the tenant,
-- '{}' means nobody (the privilege is not granted at all).

create or replace procedure app.secure_table(
  p_table regclass,
  p_select text[] default '{*}',
  p_insert text[] default '{}',
  p_update text[] default '{}',
  p_delete text[] default '{}'
)
language plpgsql
set search_path = ''
as $$
declare
  v_op text;
  v_roles text[];
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('revoke all on table %s from public, anon, authenticated', p_table);
  execute format('grant select, insert, update, delete on table %s to service_role', p_table);

  execute format(
    'create policy tenant_isolation on %s as permissive for all to authenticated '
    'using (tenant_id = (select app.current_tenant_id())) '
    'with check (tenant_id = (select app.current_tenant_id()))',
    p_table
  );

  foreach v_op in array array['select', 'insert', 'update', 'delete'] loop
    v_roles := case v_op
      when 'select' then p_select
      when 'insert' then p_insert
      when 'update' then p_update
      else p_delete
    end;
    if v_roles is null or cardinality(v_roles) = 0 then
      continue;
    end if;
    execute format('grant %s on table %s to authenticated', v_op, p_table);
    if '*' = any (v_roles) then
      continue;
    end if;
    if v_op = 'insert' then
      execute format(
        'create policy roles_insert on %s as restrictive for insert to authenticated '
        'with check ((select app.has_role(%L::text[])))',
        p_table, v_roles
      );
    elsif v_op = 'update' then
      execute format(
        'create policy roles_update on %s as restrictive for update to authenticated '
        'using ((select app.has_role(%L::text[]))) with check ((select app.has_role(%L::text[])))',
        p_table, v_roles, v_roles
      );
    else
      execute format(
        'create policy roles_%s on %s as restrictive for %s to authenticated '
        'using ((select app.has_role(%L::text[])))',
        v_op, p_table, v_op, v_roles
      );
    end if;
  end loop;

  execute format(
    'create trigger touch_updated_at before update on %s for each row execute function app.touch_updated_at()',
    p_table
  );
end
$$;

create or replace procedure app.add_version_trigger(p_table regclass)
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger bump_version before update on %s for each row execute function app.bump_version()',
    p_table
  );
end
$$;

revoke all on all functions in schema app from public;
revoke all on all procedures in schema app from public;
