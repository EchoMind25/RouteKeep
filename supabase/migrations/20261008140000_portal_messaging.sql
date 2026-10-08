-- M6: the customer portal (FR-POR-01/02) and messaging (FR-MSG-01/04).
--
-- The portal runs as its own role, `portal`, never as a member. Its claims
-- name one business and one customer; every policy below lets it read only
-- that customer's rows. Member policies are written `to authenticated`, so
-- none of them apply to the portal, and none of these apply to members.
-- Anonymous steps (asking for a sign-in link, opening it, unsubscribing) run
-- as `anon` and can only call the three functions at the end of this file.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'portal') then
    create role portal nologin noinherit;
  end if;
end
$$;
-- The connection user must be able to switch to it, as it does to `authenticated`.
do $$ begin execute format('grant portal to %I', current_user); end $$;
grant usage on schema public, app, extensions to portal;
grant usage on schema app to anon;

-- Invoker functions on purpose: they must see the caller's role, and they only read the claims.
create or replace function app.portal_tenant_id() returns uuid
language sql stable set search_path = ''
as $$
  select case when current_user = 'portal'
    then nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'portal_tenant_id', '')::uuid end
$$;

create or replace function app.portal_customer_id() returns uuid
language sql stable set search_path = ''
as $$
  select case when current_user = 'portal'
    then nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'portal_customer_id', '')::uuid end
$$;

-- What the portal may read -----------------------------------------------------------

grant select (id, name, business_license_no, state, timezone, white_label_at, logo_path) on public.tenants to portal;
create policy portal_select on public.tenants for select to portal using (id = (select app.portal_tenant_id()));

grant select on public.offices to portal;
create policy portal_select on public.offices for select to portal using (tenant_id = (select app.portal_tenant_id()));

grant select on public.service_types to portal;
create policy portal_select on public.service_types for select to portal using (tenant_id = (select app.portal_tenant_id()));

grant select (id, tenant_id, name) on public.service_plans to portal;
create policy portal_select on public.service_plans for select to portal using (tenant_id = (select app.portal_tenant_id()));

-- The technician's name appears on the customer's own service record.
grant select (id, tenant_id, display_name) on public.technicians to portal;
create policy portal_select on public.technicians for select to portal using (tenant_id = (select app.portal_tenant_id()));

grant select on public.customers to portal;
create policy portal_select on public.customers for select to portal
  using (tenant_id = (select app.portal_tenant_id()) and id = (select app.portal_customer_id()));

do $$
declare
  t text;
begin
  foreach t in array array['properties', 'subscriptions', 'appointments', 'invoices', 'ledger_entries', 'payments'] loop
    execute format('grant select on public.%I to portal', t);
    execute format(
      'create policy portal_select on public.%I for select to portal '
      'using (tenant_id = (select app.portal_tenant_id()) and customer_id = (select app.portal_customer_id()))', t);
  end loop;
end
$$;

grant select on public.invoice_lines to portal;
create policy portal_select on public.invoice_lines for select to portal
  using (tenant_id = (select app.portal_tenant_id()) and exists (
    select 1 from public.invoices i where i.tenant_id = invoice_lines.tenant_id and i.id = invoice_lines.invoice_id));

grant select on public.applications to portal;
create policy portal_select on public.applications for select to portal
  using (tenant_id = (select app.portal_tenant_id()) and exists (
    select 1 from public.appointments a where a.tenant_id = applications.tenant_id and a.id = applications.appointment_id));

grant select on public.attachments to portal;
create policy portal_select on public.attachments for select to portal
  using (tenant_id = (select app.portal_tenant_id()) and owner_type = 'appointment' and exists (
    select 1 from public.appointments a where a.tenant_id = attachments.tenant_id and a.id = attachments.owner_id));

grant select on public.invoice_balances, public.customer_balances to portal;

-- FR-POR-02: "request service" ------------------------------------------------------

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  property_id uuid,
  -- ENG-01: a double tap asks once.
  request_key text not null check (length(request_key) between 8 and 80),
  message text not null check (length(btrim(message)) between 1 and 2000),
  preferred_times text check (preferred_times is null or length(preferred_times) <= 200),
  status text not null default 'open' check (status in ('open', 'done')),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint service_request_key unique (tenant_id, request_key),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, customer_id, property_id) references public.properties (tenant_id, customer_id, id)
);
create index service_requests_open on public.service_requests (tenant_id, created_at) where status = 'open';
call app.secure_table('public.service_requests',
  p_select => '{owner,admin,office,dispatcher}', p_insert => '{}', p_update => '{owner,admin,office,dispatcher}', p_delete => '{}');
grant select, insert (tenant_id, customer_id, property_id, request_key, message, preferred_times) on public.service_requests to portal;
create policy portal_select on public.service_requests for select to portal
  using (tenant_id = (select app.portal_tenant_id()) and customer_id = (select app.portal_customer_id()));
create policy portal_insert on public.service_requests for insert to portal
  with check (tenant_id = (select app.portal_tenant_id()) and customer_id = (select app.portal_customer_id()));

-- FR-POR-01: sign-in links ----------------------------------------------------------

create table public.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade
);
create index portal_tokens_recent on public.portal_tokens (tenant_id, customer_id, created_at desc);
-- Nobody reads these through the API; only the functions below touch them.
call app.secure_table('public.portal_tokens', p_select => '{}', p_insert => '{}', p_update => '{}', p_delete => '{}');

-- Asked for by anyone who knows an email address. Says nothing about whether
-- the address is on file; at most 5 links an hour per customer. The link goes
-- out through the outbox (ENG-04) and the token in it lives 20 minutes.
create or replace function app.portal_issue_token(p_tenant_id uuid, p_email text, p_token text, p_base_url text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
begin
  if length(p_token) < 32 then
    raise exception 'token too short' using errcode = '22023';
  end if;
  select c.id into v_customer
  from public.customers c
  where c.tenant_id = p_tenant_id and c.email = lower(btrim(p_email)) and c.status = 'active'
  order by c.created_at
  limit 1;
  if v_customer is null then
    return;
  end if;
  if (select count(*) from public.portal_tokens t where t.tenant_id = p_tenant_id and t.customer_id = v_customer and t.created_at > now() - interval '1 hour') >= 5 then
    return;
  end if;
  insert into public.portal_tokens (tenant_id, customer_id, token_hash, expires_at)
  values (p_tenant_id, v_customer, encode(extensions.digest(p_token, 'sha256'), 'hex'), now() + interval '20 minutes');
  insert into public.outbox_events (tenant_id, event_id, channel, topic, payload)
  values (p_tenant_id, gen_random_uuid(), 'email', 'portal.sign_in',
          jsonb_build_object('customerId', v_customer, 'link', p_base_url || '/p/' || p_tenant_id || '/auth?token=' || p_token));
end
$$;

-- Opening the link: one use, before it expires. Returns the customer, or null.
create or replace function app.portal_redeem_token(p_tenant_id uuid, p_token text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
begin
  update public.portal_tokens t
  set used_at = now()
  where t.tenant_id = p_tenant_id
    and t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and t.used_at is null
    and t.expires_at > now()
  returning t.customer_id into v_customer;
  return v_customer;
end
$$;

-- FR-MSG-04: the unsubscribe link in every email. The server checks the
-- link's signature before calling this.
create or replace function app.unsubscribe_email(p_tenant_id uuid, p_customer_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.customers
  set email_unsubscribed_at = coalesce(email_unsubscribed_at, now()), email_opt_in = false
  where tenant_id = p_tenant_id and id = p_customer_id;
  return found;
end
$$;

revoke all on all functions in schema app from public;
grant execute on function app.portal_tenant_id(), app.portal_customer_id() to portal, authenticated, service_role;
grant execute on function app.portal_issue_token(uuid, text, text, text), app.portal_redeem_token(uuid, text), app.unsubscribe_email(uuid, uuid) to anon, service_role;
grant execute on function app.assert_invoice_total(uuid, uuid) to authenticated, service_role;
