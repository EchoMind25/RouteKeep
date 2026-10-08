-- M4 stage 2: card and bank payments through Stripe Connect (D-09).
-- FR-BIL-02 autopay, FR-BIL-04 retries, FR-BIL-06 refunds, FR-BIL-07
-- reconciliation, FR-POR-02 pay invoice and update card or bank, CR-05 (no
-- card or bank numbers here), CR-06 (stored mandate and a visible way to
-- revoke), ENG-02 (idempotency keys from row ids), ENG-03 (webhook dedupe).
--
-- Only server code holding Stripe's answer, running as service_role, writes
-- any of this. Members and the portal read it.

-- Connection state, shown in Settings and used to decide whether the portal
-- offers online payment.
alter table public.tenants
  add column stripe_details_submitted boolean not null default false,
  add column stripe_reconciled_at timestamptz;
grant select (stripe_charges_enabled) on public.tenants to portal;

-- Saved payment methods (FR-BIL-02, CR-06) ---------------------------------------------
-- What a person needs to recognise the method and Stripe's ids, nothing more.
-- One active method per customer; setting up a new one replaces the old.

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  stripe_payment_method_id text not null check (length(stripe_payment_method_id) between 3 and 255),
  stripe_mandate_id text,
  kind text not null check (kind in ('card', 'us_bank_account')),
  -- "Visa ending 4242", "STRIPE TEST BANK ending 6789"
  label text not null check (length(label) between 1 and 80),
  exp_month smallint check (exp_month between 1 and 12),
  exp_year smallint,
  -- CR-06: the words the customer agreed to, as shown, and when.
  consent_text text not null check (length(consent_text) between 20 and 2000),
  consented_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'replaced')),
  revoked_at timestamptz,
  revoked_by text check (revoked_by in ('customer', 'office', 'stripe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint payment_method_stripe_id unique (tenant_id, stripe_payment_method_id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  constraint revoked_is_dated check ((status = 'active') = (revoked_at is null)),
  constraint bank_has_mandate check (kind <> 'us_bank_account' or stripe_mandate_id is not null)
);
create unique index payment_methods_one_active on public.payment_methods (tenant_id, customer_id) where status = 'active';

call app.secure_table('public.payment_methods',
  p_select => '{owner,admin,office}', p_insert => '{}', p_update => '{}', p_delete => '{}');
grant select on public.payment_methods to portal;
create policy portal_select on public.payment_methods for select to portal
  using (tenant_id = (select app.portal_tenant_id()) and customer_id = (select app.portal_customer_id()));

-- Payments: which Checkout page or saved method a payment came from ---------------------

alter table public.payments
  add column stripe_checkout_session_id text,
  add column payment_method_id uuid,
  add constraint payments_checkout_session unique (stripe_checkout_session_id),
  add constraint payments_payment_method foreign key (tenant_id, payment_method_id) references public.payment_methods (tenant_id, id);
create index payments_pending_online on public.payments (tenant_id, invoice_id) where status in ('pending', 'processing') and method in ('card', 'ach', 'card_on_file');

-- FR-BIL-04: autopay attempts per invoice. The billing run charges an invoice
-- when autopay_next_at has passed; each failure moves it out (3 attempts).

alter table public.invoices
  add column autopay_attempts smallint not null default 0 check (autopay_attempts between 0 and 10),
  add column autopay_next_at timestamptz,
  add column autopay_last_error text check (autopay_last_error is null or length(autopay_last_error) <= 300);
create index invoices_autopay_due on public.invoices (tenant_id, autopay_next_at) where status = 'open' and autopay_next_at is not null;

-- FR-BIL-07: what the nightly reconciliation could not square ---------------------------

create table public.reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('amount_mismatch', 'unknown_payment', 'status_mismatch', 'refund_failed', 'dispute')),
  stripe_object_id text not null check (length(stripe_object_id) between 3 and 255),
  payment_id uuid,
  details text not null check (length(details) between 1 and 500),
  found_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint reconciliation_issue_key unique (tenant_id, kind, stripe_object_id),
  foreign key (tenant_id, payment_id) references public.payments (tenant_id, id)
);
create index reconciliation_open on public.reconciliation_issues (tenant_id, found_at) where resolved_at is null;

call app.secure_table('public.reconciliation_issues',
  p_select => '{owner,admin}', p_insert => '{}', p_update => '{owner,admin}', p_delete => '{}');
revoke update on public.reconciliation_issues from authenticated;
grant update (resolved_at, resolved_by) on public.reconciliation_issues to authenticated;
