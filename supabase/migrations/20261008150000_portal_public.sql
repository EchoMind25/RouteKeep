-- M6: what a signed-out visitor to a business's portal may know: its name,
-- whether it has a logo (and where), and whether it is white label. Nothing
-- else about the business is readable without signing in.
create or replace function app.portal_business(p_tenant_id uuid)
returns table (name text, logo_path text, white_label boolean, phone text)
language sql stable security definer set search_path = ''
as $$
  select t.name, t.logo_path, t.white_label_at is not null,
         (select o.phone from public.offices o where o.tenant_id = t.id and o.is_primary limit 1)
  from public.tenants t
  where t.id = p_tenant_id
$$;

revoke all on all functions in schema app from public;
grant execute on function app.portal_business(uuid) to anon, portal, authenticated, service_role;
grant execute on function app.portal_tenant_id(), app.portal_customer_id() to portal, authenticated, service_role;
grant execute on function app.portal_issue_token(uuid, text, text, text), app.portal_redeem_token(uuid, text), app.unsubscribe_email(uuid, uuid) to anon, service_role;
grant execute on function app.assert_invoice_total(uuid, uuid) to authenticated, service_role;

-- ENG-04: queue a message once. Members may add to the outbox but not read it
-- (only owner and admin can), and "add unless already there" needs a read, so
-- the insert runs here: for a member, only into their own business; for the
-- service role (jobs), into the business it names.
create or replace function app.enqueue_outbox(p_tenant_id uuid, p_event_id uuid, p_channel text, p_topic text, p_payload jsonb, p_available_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and p_tenant_id is distinct from app.current_tenant_id() then
    raise exception 'not your business' using errcode = '42501';
  end if;
  insert into public.outbox_events (tenant_id, event_id, channel, topic, payload, available_at)
  values (p_tenant_id, p_event_id, p_channel, p_topic, p_payload, coalesce(p_available_at, now()))
  on conflict (event_id, channel) do nothing;
end
$$;
revoke all on function app.enqueue_outbox(uuid, uuid, text, text, jsonb, timestamptz) from public;
grant execute on function app.enqueue_outbox(uuid, uuid, text, text, jsonb, timestamptz) to authenticated, service_role;
