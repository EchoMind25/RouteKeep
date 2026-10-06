-- Tenancy: tenants, offices, memberships, technicians, the tenant context
-- functions every RLS policy uses, the Supabase access token hook, and the
-- functions that create tenants and manage members.
-- PRD: FR-SET-01, FR-SET-02, ENG-08, CR-10, CR-15.

-- Tenants ------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text not null references app.iana_zones (name),
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  business_license_no text not null check (length(btrim(business_license_no)) between 1 and 60),
  plan text not null default 'starter' check (plan in ('starter', 'pro', 'growth')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  messaging_live_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  client_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, client_key)
);
comment on column public.tenants.messaging_live_at is 'FR-MIG-19: customer messaging stays suppressed for imported records until the owner clicks Go live.';
comment on column public.tenants.client_key is 'ENG-01: a double-submitted signup form creates one tenant, not two.';

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  address_line1 text not null check (length(btrim(address_line1)) > 0),
  address_line2 text,
  city text not null check (length(btrim(city)) > 0),
  region char(2) not null check (region ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  business_license_no text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index offices_one_primary on public.offices (tenant_id) where is_primary;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'office', 'dispatcher', 'technician')),
  email text,
  display_name text,
  invited_by uuid references auth.users (id) on delete set null,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);
create index memberships_user on public.memberships (user_id) where deactivated_at is null;

-- Tenant context -----------------------------------------------------------------
-- The JWT names a tenant (custom access token hook below); these functions only
-- trust that claim while an active membership backs it, so revoking a member
-- takes effect on their next query, not when their token expires.

create or replace function app.current_tenant_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
    and m.deactivated_at is null
$$;

create or replace function app.current_member_role() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
    and m.deactivated_at is null
$$;

create or replace function app.has_role(p_roles text[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_member_role() = any (p_roles), false)
$$;

grant execute on function app.current_tenant_id() to authenticated, service_role;
grant execute on function app.current_member_role() to authenticated, service_role;
grant execute on function app.has_role(text[]) to authenticated, service_role;

-- Inserts may omit tenant_id; it defaults to the caller's tenant. Jobs running
-- as service_role have no tenant claim and must pass it explicitly.
alter table public.offices alter column tenant_id set default app.current_tenant_id();

-- RLS for the tenancy tables -----------------------------------------------------

alter table public.tenants enable row level security;
revoke all on table public.tenants from public, anon, authenticated;
grant select, insert, update, delete on table public.tenants to service_role;
grant select on table public.tenants to authenticated;
-- Plan, Stripe and go-live fields change only through server code running as
-- service_role, never directly by a member.
grant update (name, timezone, state, business_license_no, settings) on table public.tenants to authenticated;
create policy tenant_self_select on public.tenants
  for select to authenticated
  using (id = (select app.current_tenant_id()));
create policy tenant_self_update on public.tenants
  for update to authenticated
  using (id = (select app.current_tenant_id()) and (select app.has_role('{owner,admin}')))
  with check (id = (select app.current_tenant_id()));
create trigger touch_updated_at before update on public.tenants
  for each row execute function app.touch_updated_at();

call app.secure_table('public.offices',
  p_select => '{*}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Memberships are readable by the tenant and by the member themself (for a
-- tenant switcher). All writes go through the functions below.
alter table public.memberships enable row level security;
revoke all on table public.memberships from public, anon, authenticated;
grant select, insert, update, delete on table public.memberships to service_role;
grant select on table public.memberships to authenticated;
create policy tenant_isolation on public.memberships
  for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) or user_id = (select auth.uid()));
create trigger touch_updated_at before update on public.memberships
  for each row execute function app.touch_updated_at();

-- A tenant always keeps at least one active owner (unless the tenant itself is
-- being deleted).
create or replace function app.guard_last_owner() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  if exists (select 1 from public.tenants t where t.id = v_tenant)
     and not exists (
       select 1 from public.memberships m
       where m.tenant_id = v_tenant and m.role = 'owner' and m.deactivated_at is null
     ) then
    raise exception 'a tenant must keep at least one active owner' using errcode = '23514';
  end if;
  return null;
end
$$;
create trigger guard_last_owner after update or delete on public.memberships
  for each row execute function app.guard_last_owner();

-- Technicians --------------------------------------------------------------------
-- FR-SET-02: a technician cannot exist without an applicator license number and
-- expiry, because every application record (CR-01) copies them.

create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  applicator_license_no text not null check (length(btrim(applicator_license_no)) between 1 and 60),
  license_expiry date not null,
  categories text[] not null default '{}',
  color_index smallint not null default 0 check (color_index between 0 and 11),
  active boolean not null default true,
  source text not null default 'manual',
  external_ref text,
  import_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id),
  unique (tenant_id, source, external_ref)
);

call app.secure_table('public.technicians',
  p_select => '{*}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{}');

-- Supabase custom access token hook -----------------------------------------------
-- Enable in the dashboard: Authentication > Hooks > Custom Access Token >
-- public.custom_access_token_hook. Adds `tenant_id` and `user_role` claims.
-- A user with several tenants picks one by setting app_metadata.active_tenant_id.

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid := (event ->> 'user_id')::uuid;
  v_requested text := v_claims -> 'app_metadata' ->> 'active_tenant_id';
  v_tenant uuid;
  v_role text;
begin
  select m.tenant_id, m.role
    into v_tenant, v_role
  from public.memberships m
  where m.user_id = v_user
    and m.deactivated_at is null
  order by (m.tenant_id::text = coalesce(v_requested, '')) desc, m.created_at asc
  limit 1;

  if v_tenant is null then
    v_claims := v_claims - 'tenant_id' - 'user_role';
  else
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant::text));
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end
$$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- Tenant creation (FR-SET-01) -----------------------------------------------------

create or replace function app.create_tenant(
  p_name text,
  p_timezone text,
  p_state text,
  p_business_license_no text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_postal_code text,
  p_phone text,
  p_client_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_email text;
begin
  if v_user is null then
    raise exception 'sign in before creating a business' using errcode = '28000';
  end if;

  select t.id into v_tenant
  from public.tenants t
  where t.created_by = v_user and t.client_key = p_client_key;
  if v_tenant is not null then
    return v_tenant;
  end if;

  if (select count(*) from public.memberships m where m.user_id = v_user and m.role = 'owner') >= 3 then
    raise exception 'owner already has the maximum number of businesses' using errcode = '54000';
  end if;

  insert into public.tenants (name, timezone, state, business_license_no, created_by, client_key)
  values (btrim(p_name), p_timezone, upper(p_state), btrim(p_business_license_no), v_user, p_client_key)
  returning id into v_tenant;

  insert into public.offices (tenant_id, name, address_line1, address_line2, city, region, postal_code, phone, is_primary)
  values (v_tenant, btrim(p_name), btrim(p_address_line1), nullif(btrim(p_address_line2), ''), btrim(p_city),
          upper(p_state), btrim(p_postal_code), nullif(btrim(p_phone), ''), true);

  select u.email into v_email from auth.users u where u.id = v_user;
  insert into public.memberships (tenant_id, user_id, role, email)
  values (v_tenant, v_user, 'owner', v_email);

  return v_tenant;
end
$$;
grant execute on function app.create_tenant(text, text, text, text, text, text, text, text, text, text) to authenticated;

-- Member management (FR-SET-02) -----------------------------------------------------
-- Owners manage everyone. Admins manage office, dispatcher and technician seats.

create or replace function app.assert_can_assign(p_role text) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_role not in ('owner', 'admin', 'office', 'dispatcher', 'technician') then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;
  if app.has_role('{owner}') then
    return;
  end if;
  if app.has_role('{admin}') and p_role in ('office', 'dispatcher', 'technician') then
    return;
  end if;
  raise exception 'not allowed to assign role %', p_role using errcode = '42501';
end
$$;

create or replace function app.add_member(
  p_user_id uuid,
  p_email text,
  p_role text,
  p_display_name text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid;
begin
  if v_tenant is null then
    raise exception 'no active tenant' using errcode = '42501';
  end if;
  perform app.assert_can_assign(p_role);

  insert into public.memberships (tenant_id, user_id, role, email, display_name, invited_by)
  values (v_tenant, p_user_id, p_role, p_email, nullif(btrim(p_display_name), ''), auth.uid())
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        email = excluded.email,
        display_name = coalesce(excluded.display_name, public.memberships.display_name),
        deactivated_at = null
  returning id into v_id;
  return v_id;
end
$$;

create or replace function app.set_member_role(p_membership_id uuid, p_role text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_current text;
begin
  select m.role into v_current
  from public.memberships m
  where m.id = p_membership_id and m.tenant_id = v_tenant;
  if v_current is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  perform app.assert_can_assign(v_current);
  perform app.assert_can_assign(p_role);
  update public.memberships set role = p_role where id = p_membership_id;
end
$$;

create or replace function app.deactivate_member(p_membership_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_current text;
begin
  select m.role into v_current
  from public.memberships m
  where m.id = p_membership_id and m.tenant_id = v_tenant;
  if v_current is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  perform app.assert_can_assign(v_current);
  update public.memberships set deactivated_at = now() where id = p_membership_id;
end
$$;

revoke all on all functions in schema app from public;
grant execute on function app.current_tenant_id() to authenticated, service_role;
grant execute on function app.current_member_role() to authenticated, service_role;
grant execute on function app.has_role(text[]) to authenticated, service_role;
grant execute on function app.create_tenant(text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function app.add_member(uuid, text, text, text) to authenticated;
grant execute on function app.set_member_role(uuid, text) to authenticated;
grant execute on function app.deactivate_member(uuid) to authenticated;
