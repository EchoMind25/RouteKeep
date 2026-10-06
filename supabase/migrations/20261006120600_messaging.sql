-- Messaging, the transactional outbox, and inbound webhook dedupe.
-- PRD: FR-MSG-01..05, ENG-03, ENG-04, DB-03, DB-04, CR-07, R-BUG-10, R-BUG-15.

-- Outbox (ENG-04): rows are written in the same transaction as the change that
-- caused them, and a job sends them only after that transaction commits.
create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  event_id uuid not null,
  channel text not null check (channel in ('email', 'sms', 'job')),
  topic text not null check (topic ~ '^[a-z]+(\.[a-z_]+)+$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint outbox_event_channel unique (event_id, channel)
);
create index outbox_pending on public.outbox_events (available_at) where sent_at is null;

call app.secure_table('public.outbox_events',
  p_select => '{owner,admin}', p_insert => '{*}', p_update => '{}', p_delete => '{}');

-- Messages (FR-MSG-05): every message the tenant could be billed for is a row
-- they can see, with the provider's id, so usage can always be explained.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid,
  appointment_id uuid,
  invoice_id uuid,
  outbox_event_id uuid,
  channel text not null check (channel in ('email', 'sms')),
  template text not null,
  recipient text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed')),
  suppressed_reason text,
  provider text check (provider in ('resend', 'twilio')),
  provider_id text,
  error text,
  billed_units integer not null default 0 check (billed_units >= 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (provider, provider_id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, outbox_event_id) references public.outbox_events (tenant_id, id),
  constraint suppressed_is_explained check (status <> 'suppressed' or suppressed_reason is not null)
);
create index messages_customer on public.messages (tenant_id, customer_id, created_at desc);
create index messages_usage on public.messages (tenant_id, created_at) where billed_units > 0;

call app.secure_table('public.messages',
  p_select => '{*}', p_insert => '{}', p_update => '{}', p_delete => '{}');

-- Inbound webhooks (ENG-03, DB-03). tenant_id is null for platform-level events
-- (RouteKeep's own Stripe Billing, D-12); those are visible to no tenant.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'resend', 'twilio')),
  event_id text not null,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_events_dedupe unique (provider, event_id)
);
create index webhook_events_unprocessed on public.webhook_events (received_at) where processed_at is null;

call app.secure_table('public.webhook_events',
  p_select => '{owner,admin}', p_insert => '{}', p_update => '{}', p_delete => '{}');

revoke all on all functions in schema app from public;
