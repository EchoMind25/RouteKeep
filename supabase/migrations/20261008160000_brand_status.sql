-- FR-BRD-03: a white label business's accent colour. Owners and admins set it
-- in Settings; it shows only once the platform has switched white label on.
alter table public.tenants add column brand_accent text check (brand_accent is null or brand_accent ~ '^#[0-9a-f]{6}$');
grant update (brand_accent) on public.tenants to authenticated;
grant select (brand_accent) on public.tenants to portal;

-- NFR-04: the public status page. Aggregates only: no business, customer or
-- message is identifiable from it.
create or replace function app.system_status()
returns table (database_ok boolean, outbox_waiting integer, outbox_oldest_minutes integer, messages_failed_24h integer, billing_last_finished timestamptz, billing_failures_24h integer)
language sql stable security definer set search_path = ''
as $$
  select
    true,
    (select count(*)::int from public.outbox_events where sent_at is null and available_at <= now()),
    (select coalesce(extract(epoch from now() - min(available_at))::int / 60, 0) from public.outbox_events where sent_at is null and available_at <= now()),
    (select count(*)::int from public.messages where status = 'failed' and created_at > now() - interval '24 hours'),
    (select max(finished_at) from public.billing_runs),
    (select coalesce(sum(jsonb_array_length(failures)), 0)::int from public.billing_runs where started_at > now() - interval '24 hours')
$$;

revoke all on all functions in schema app from public;
grant execute on function app.system_status() to anon, service_role;
grant execute on function app.portal_business(uuid) to anon, portal, authenticated, service_role;
grant execute on function app.portal_tenant_id(), app.portal_customer_id() to portal, authenticated, service_role;
grant execute on function app.portal_issue_token(uuid, text, text, text), app.portal_redeem_token(uuid, text), app.unsubscribe_email(uuid, uuid) to anon, service_role;
grant execute on function app.enqueue_outbox(uuid, uuid, text, text, jsonb, timestamptz) to authenticated, service_role;
grant execute on function app.assert_invoice_total(uuid, uuid) to authenticated, service_role;

-- The portal's signed-out pages show the business's colour too.
drop function app.portal_business(uuid);
create function app.portal_business(p_tenant_id uuid)
returns table (name text, logo_path text, white_label boolean, phone text, brand_accent text)
language sql stable security definer set search_path = ''
as $$
  select t.name, t.logo_path, t.white_label_at is not null,
         (select o.phone from public.offices o where o.tenant_id = t.id and o.is_primary limit 1),
         case when t.white_label_at is not null then t.brand_accent end
  from public.tenants t
  where t.id = p_tenant_id
$$;
revoke all on function app.portal_business(uuid) from public;
grant execute on function app.portal_business(uuid) to anon, portal, authenticated, service_role;

-- FR-MIG-19: "Go live" sets tenants.messaging_live_at, a column members cannot
-- write directly; owners and admins do it through this, once.
create or replace function app.go_live() returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not app.has_role('{owner,admin}') then
    raise exception 'only an owner or admin can go live' using errcode = '42501';
  end if;
  update public.tenants set messaging_live_at = coalesce(messaging_live_at, now())
  where id = app.current_tenant_id()
  returning messaging_live_at into v_at;
  return v_at;
end
$$;
revoke all on function app.go_live() from public;
grant execute on function app.go_live() to authenticated;
