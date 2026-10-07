-- FR-SAL-01..04: technicians add customers from the field, and earn a
-- commission on each one. Off unless the owner turns it on. The commission is
-- computed here from the business's rule at the moment of the sale, so a
-- technician can never set or change their own amount.

-- FR-SAL-01: the owner's rule. Flat amount per sale plus a percent of the
-- plan's first service price; either may be zero.
alter table public.tenants
  add column tech_sales_enabled boolean not null default false,
  add column commission_flat_cents integer not null default 0 check (commission_flat_cents between 0 and 10000000),
  add column commission_pct numeric(5, 2) not null default 0 check (commission_pct between 0 and 100);
grant update (tech_sales_enabled, commission_flat_cents, commission_pct) on table public.tenants to authenticated;

-- FR-SAL-02: who made the sale. Set when the customer is created; the office
-- may also credit a technician when it enters a sale phoned in from the field.
alter table public.customers add column sold_by_technician_id uuid;
alter table public.customers
  add constraint customers_sold_by foreign key (tenant_id, sold_by_technician_id) references public.technicians (tenant_id, id);
create index customers_sold_by on public.customers (tenant_id, sold_by_technician_id) where sold_by_technician_id is not null;

-- The calling member's technician profile, if any.
create or replace function app.current_technician_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.technicians t
  where t.tenant_id = app.current_tenant_id() and t.user_id = auth.uid() and t.active
  limit 1
$$;

create or replace function app.tech_sales_enabled() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select t.tech_sales_enabled from public.tenants t where t.id = app.current_tenant_id()), false)
$$;

-- A technician may add a customer, its property and its plan only when the
-- owner allows it, and only credited to themselves.
create or replace function app.sold_by_me(p_customer_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = app.current_tenant_id()
      and c.sold_by_technician_id is not null and c.sold_by_technician_id = app.current_technician_id()
  )
$$;

revoke all on function app.current_technician_id(), app.tech_sales_enabled(), app.sold_by_me(uuid) from public;
grant execute on function app.current_technician_id(), app.tech_sales_enabled(), app.sold_by_me(uuid) to authenticated, service_role;

drop policy roles_insert on public.customers;
create policy roles_insert on public.customers as restrictive for insert to authenticated
  with check (
    (select app.has_role('{owner,admin,office,dispatcher}'))
    or ((select app.has_role('{technician}')) and (select app.tech_sales_enabled())
        and sold_by_technician_id is not null and sold_by_technician_id = (select app.current_technician_id()))
  );

drop policy roles_insert on public.properties;
create policy roles_insert on public.properties as restrictive for insert to authenticated
  with check (
    (select app.has_role('{owner,admin,office,dispatcher}'))
    or ((select app.has_role('{technician}')) and (select app.tech_sales_enabled()) and app.sold_by_me(customer_id))
  );

drop policy roles_insert on public.subscriptions;
create policy roles_insert on public.subscriptions as restrictive for insert to authenticated
  with check (
    (select app.has_role('{owner,admin,office}'))
    or ((select app.has_role('{technician}')) and (select app.tech_sales_enabled()) and app.sold_by_me(customer_id))
  );

-- Generating the new plan's first visits records how far it has generated.
-- A technician may touch only a plan they sold in the last hour, nothing older.
drop policy roles_update on public.subscriptions;
create policy roles_update on public.subscriptions as restrictive for update to authenticated
  using (
    (select app.has_role('{owner,admin,office}'))
    or ((select app.has_role('{technician}')) and app.sold_by_me(customer_id) and created_at > now() - interval '1 hour')
  )
  with check (
    (select app.has_role('{owner,admin,office}'))
    or ((select app.has_role('{technician}')) and app.sold_by_me(customer_id) and created_at > now() - interval '1 hour')
  );

-- FR-SAL-02, FR-SAL-03: one commission per customer sold.
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  technician_id uuid not null,
  customer_id uuid not null,
  subscription_id uuid,
  -- The rule as it stood at the sale, and what it was applied to (ENG-06: cents).
  basis_cents integer not null check (basis_cents >= 0),
  flat_cents integer not null check (flat_cents >= 0),
  pct numeric(5, 2) not null check (pct between 0 and 100),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  note text check (note is null or length(note) <= 500),
  decided_by uuid,
  decided_at timestamptz,
  created_by uuid default auth.uid(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint commissions_one_per_customer unique (tenant_id, customer_id),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, subscription_id) references public.subscriptions (tenant_id, id),
  constraint void_has_reason check (status <> 'void' or note is not null)
);
create index commissions_by_technician on public.commissions (tenant_id, technician_id, created_at);
create index commissions_by_date on public.commissions (tenant_id, created_at);

-- Rows are made only by app.record_sale_commission; the office decides them.
call app.secure_table('public.commissions',
  p_select => '{*}', p_insert => '{}', p_update => '{owner,admin,office}', p_delete => '{}');
-- FR-SAL-04: a technician sees only their own.
create policy own_commissions on public.commissions as restrictive for select to authenticated
  using ((select app.has_role('{owner,admin,office,dispatcher}')) or technician_id = (select app.current_technician_id()));
call app.add_version_trigger('public.commissions');
create trigger audit_row after insert or update or delete on public.commissions
  for each row execute function app.audit_row();

-- FR-SAL-03: pending -> approved -> paid; anything but paid may be voided (with
-- a reason); paid is final. Only the status, its note and who decided change.
create or replace function app.guard_commission() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if app.purge_allowed(old.tenant_id) then
      return old;
    end if;
    raise exception 'commissions are kept; void one instead' using errcode = '42501';
  end if;
  if (new.tenant_id, new.technician_id, new.customer_id, new.subscription_id, new.basis_cents, new.flat_cents, new.pct, new.amount_cents, new.created_at, new.created_by)
     is distinct from
     (old.tenant_id, old.technician_id, old.customer_id, old.subscription_id, old.basis_cents, old.flat_cents, old.pct, old.amount_cents, old.created_at, old.created_by) then
    raise exception 'a commission amount and what it was earned on are fixed at the sale' using errcode = '42501';
  end if;
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'paid' or old.status = 'void'
     or (old.status = 'pending' and new.status not in ('approved', 'void'))
     or (old.status = 'approved' and new.status not in ('paid', 'void', 'pending')) then
    raise exception 'a commission cannot go from % to %', old.status, new.status using errcode = '23514';
  end if;
  new.decided_by := auth.uid();
  new.decided_at := now();
  return new;
end
$$;
revoke all on function app.guard_commission() from public;
create trigger guard_commission before update or delete on public.commissions
  for each row execute function app.guard_commission();

-- FR-SAL-02: records the commission for a customer credited to a technician.
-- Callable by the office, or by that technician; idempotent per customer.
create or replace function app.record_sale_commission(p_customer_id uuid, p_subscription_id uuid default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_customer public.customers;
  v_tenant_row public.tenants;
  v_basis integer := 0;
  v_id uuid;
begin
  select * into v_customer from public.customers where id = p_customer_id and tenant_id = v_tenant;
  if v_customer.id is null or v_customer.sold_by_technician_id is null then
    raise exception 'that customer is not credited to a technician' using errcode = '22023';
  end if;
  if not (app.has_role('{owner,admin,office,dispatcher}') or v_customer.sold_by_technician_id = app.current_technician_id()) then
    raise exception 'only the office or the selling technician can record this sale' using errcode = '42501';
  end if;
  select * into v_tenant_row from public.tenants where id = v_tenant;
  if p_subscription_id is not null then
    select coalesce(s.initial_price_cents, s.price_cents, 0) into v_basis
    from public.subscriptions s where s.id = p_subscription_id and s.tenant_id = v_tenant and s.customer_id = p_customer_id;
    if not found then
      raise exception 'that plan does not belong to this customer' using errcode = '22023';
    end if;
  end if;
  insert into public.commissions (tenant_id, technician_id, customer_id, subscription_id, basis_cents, flat_cents, pct, amount_cents, created_by)
  values (
    v_tenant, v_customer.sold_by_technician_id, p_customer_id, p_subscription_id, v_basis,
    v_tenant_row.commission_flat_cents, v_tenant_row.commission_pct,
    v_tenant_row.commission_flat_cents + round(v_basis * v_tenant_row.commission_pct / 100)::integer,
    auth.uid()
  )
  on conflict on constraint commissions_one_per_customer do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.commissions where tenant_id = v_tenant and customer_id = p_customer_id;
  end if;
  return v_id;
end
$$;
revoke all on function app.record_sale_commission(uuid, uuid) from public;
grant execute on function app.record_sale_commission(uuid, uuid) to authenticated;
