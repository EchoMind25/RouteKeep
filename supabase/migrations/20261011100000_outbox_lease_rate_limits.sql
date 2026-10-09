-- Outbox lease and portal abuse limits.
-- PRD: ENG-04, FR-MSG-05 (outbox sends happen outside the transaction), FR-POR-01.

-- A runner claims a small batch by setting a lease, then sends with no
-- transaction open. A crashed runner's rows become claimable again when the
-- lease passes. The outbox_pending partial index still serves the claim query
-- (sent_at is null, ordered by available_at); the lease check is a cheap filter.
alter table public.outbox_events add column locked_until timestamptz;

-- Fixed-window counters for unauthenticated endpoints (FR-POR-01). Not tenant
-- data: keys are opaque strings (for example "portal-link:<tenant>:<ip>"), so
-- it lives in the private app schema, outside secure_table, and no API role can
-- read or write it. Only app.rate_limit_hit touches it.
create table app.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
revoke all on app.rate_limits from public, anon, authenticated, portal;

-- True when this call is within the limit. Counts every call, allowed or not.
-- Use a distinct key per window length.
create or replace function app.rate_limit_hit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz;
  v_count integer;
begin
  if p_window_seconds < 1 or p_max < 1 then
    raise exception 'bad rate limit' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into app.rate_limits as r (key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  -- Opportunistic cleanup, about one call in fifty.
  if random() < 0.02 then
    delete from app.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_count <= p_max;
end
$$;

-- True only when a link was issued, so the caller sends mail only then. The
-- caller answers the person the same way regardless (FR-POR-01).
drop function app.portal_issue_token(uuid, text, text, text);
create function app.portal_issue_token(p_tenant_id uuid, p_email text, p_token text, p_base_url text) returns boolean
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
    return false;
  end if;
  if (select count(*) from public.portal_tokens t where t.tenant_id = p_tenant_id and t.customer_id = v_customer and t.created_at > now() - interval '1 hour') >= 5 then
    return false;
  end if;
  insert into public.portal_tokens (tenant_id, customer_id, token_hash, expires_at)
  values (p_tenant_id, v_customer, encode(extensions.digest(p_token, 'sha256'), 'hex'), now() + interval '20 minutes');
  insert into public.outbox_events (tenant_id, event_id, channel, topic, payload)
  values (p_tenant_id, gen_random_uuid(), 'email', 'portal.sign_in',
          jsonb_build_object('customerId', v_customer, 'link', p_base_url || '/p/' || p_tenant_id || '/auth?token=' || p_token));
  return true;
end
$$;

revoke all on function app.portal_issue_token(uuid, text, text, text), app.rate_limit_hit(text, int, int) from public;
grant execute on function app.portal_issue_token(uuid, text, text, text), app.rate_limit_hit(text, int, int) to anon, service_role;
