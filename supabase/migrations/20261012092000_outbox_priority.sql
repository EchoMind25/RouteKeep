-- Outbox priority lane. PRD: ENG-04, FR-MSG-01.
-- Time-sensitive messages (on the way, visit complete, sign-in link, payments)
-- are priority 0 and are claimed before bulk mail such as reminders (1).
alter table public.outbox_events add column priority smallint not null default 1;

-- One place decides the lane, so every insert path (app.enqueue_outbox and the
-- direct portal inserts) agrees with lib/messaging/enqueue.ts.
create or replace function app.outbox_priority() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.topic in ('appointment.on_the_way', 'appointment.completed', 'portal.sign_in') or new.topic like 'payment.%' then
    new.priority := 0;
  end if;
  return new;
end
$$;
create trigger outbox_events_priority before insert on public.outbox_events
  for each row execute function app.outbox_priority();

-- Matches the claim query: unsent, ordered by priority then available_at.
-- The lease (locked_until), channel and available_at <= now() are cheap filters.
drop index public.outbox_pending;
create index outbox_pending on public.outbox_events (priority, available_at) where sent_at is null;
revoke all on function app.outbox_priority() from public;
