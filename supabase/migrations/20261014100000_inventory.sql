-- Inventory, resupply and truck stock (FR-INV-01..10).
-- PRD: FR-INV-*, ENG-01 (client keys), ENG-06 (integer cents, append-only ledger), DB-05, G-04.
--
-- Design: product used in the field is never written twice. Usage is derived
-- from the legal application records (current versions only) at read time, so a
-- record is never blocked, slowed or contradicted by inventory (G-04), and an
-- amendment corrects stock automatically. What is stored here is only what the
-- records cannot know: counts, receipts, transfers between the shop and trucks,
-- and adjustments. On hand at a location = the latest count + movements after
-- it - product used by that truck's technician after it (lib/domain/inventory.ts). A pair
-- never counted starts at the location's created_at, not the beginning of time.
-- The weekly resupply-day count bounds how far back that sum ever reaches.

-- Tenant settings (FR-INV-01) -------------------------------------------------------------
-- off: nothing new beyond the forecast report. forecast: vendors, resupply list,
-- purchase orders, spend. tracked: also stock on hand, trucks and counts.
alter table public.tenants
  add column inventory_mode text not null default 'off' check (inventory_mode in ('off', 'forecast', 'tracked')),
  -- 0 = Sunday ... 6 = Saturday, business-local. Technicians count their truck on this day (FR-INV-07).
  add column resupply_weekday smallint check (resupply_weekday between 0 and 6);
-- Owners and admins change them through RLS (tenant_self_update); no other tenant column opens up.
grant update (inventory_mode, resupply_weekday) on table public.tenants to authenticated;

-- Products: the unit stock is kept in, and how many days of cover to hold back.
alter table public.products
  add column stock_unit text check (stock_unit in ('fl_oz', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each')),
  add column safety_days smallint not null default 7 check (safety_days between 0 and 60);

-- Vendors (FR-INV-04) ---------------------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or length(phone) <= 40),
  account_no text check (account_no is null or length(account_no) <= 80),
  -- Days the business usually places orders, 0 = Sunday. Empty means "any day".
  order_weekdays smallint[] not null default '{}' check (order_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  min_order_cents integer check (min_order_cents >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  active boolean not null default true,
  client_key text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint vendors_client_key unique (tenant_id, client_key)
);
create unique index vendors_name on public.vendors (tenant_id, lower(name));

call app.secure_table('public.vendors',
  p_select => '{owner,admin,office}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- What a vendor sells: one row per package size. Price and package are what the
-- next order copies; an order line keeps its own copy (price history never moves).
create table public.vendor_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  vendor_id uuid not null,
  product_id uuid not null,
  sku text check (sku is null or length(sku) <= 80),
  package_label text not null check (length(btrim(package_label)) between 1 and 80),
  package_qty numeric(14, 6) not null check (package_qty > 0),
  package_unit text not null check (package_unit in ('fl_oz', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each')),
  price_cents integer check (price_cents >= 0),
  lead_time_days smallint not null default 2 check (lead_time_days between 0 and 60),
  preferred boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, vendor_id, product_id, package_label),
  foreign key (tenant_id, vendor_id) references public.vendors (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index vendor_products_vendor on public.vendor_products (tenant_id, vendor_id);
create index vendor_products_product on public.vendor_products (tenant_id, product_id);
-- One preferred package per product: the resupply list orders it.
create unique index vendor_products_preferred on public.vendor_products (tenant_id, product_id) where preferred and active;

call app.secure_table('public.vendor_products',
  p_select => '{owner,admin,office}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Stock locations (FR-INV-06) ---------------------------------------------------------------
-- The shop and each truck. A truck belongs to at most one active technician;
-- usage on that technician's records comes out of it.

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('shop', 'truck')),
  name text not null check (length(btrim(name)) between 1 and 80),
  technician_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id),
  constraint shop_has_no_technician check (kind = 'truck' or technician_id is null)
);
create unique index stock_locations_name on public.stock_locations (tenant_id, lower(name)) where active;
create unique index stock_locations_technician on public.stock_locations (tenant_id, technician_id) where active and technician_id is not null;
create index stock_locations_technician_fk on public.stock_locations (tenant_id, technician_id);

call app.secure_table('public.stock_locations',
  p_select => '{*}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{}');

-- A technician added while the business tracks stock gets a truck at once, so
-- their first resupply-day check is never skipped for want of a location (FR-INV-07).
-- One naming rule, shared with ensureLocations in lib/server/inventory.ts: "Truck <name>",
-- then "Truck <name> 2", "Truck <name> 3" when the name is taken. A clash never costs a technician their truck.
create or replace function app.truck_for_new_technician() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := left('Truck ' || btrim(new.display_name), 76);
  v_name text := v_base;
  n integer := 1;
begin
  if exists (select 1 from public.tenants t where t.id = new.tenant_id and t.inventory_mode = 'tracked')
     and not exists (select 1 from public.stock_locations l where l.tenant_id = new.tenant_id and l.technician_id = new.id and l.active) then
    perform pg_advisory_xact_lock(hashtextextended('truck:' || new.tenant_id::text, 0));
    while exists (select 1 from public.stock_locations l where l.tenant_id = new.tenant_id and l.active and lower(l.name) = lower(v_name)) loop
      n := n + 1;
      v_name := v_base || ' ' || n;
    end loop;
    insert into public.stock_locations (tenant_id, kind, name, technician_id) values (new.tenant_id, 'truck', v_name, new.id);
  end if;
  return new;
end
$$;
create trigger truck_for_new_technician after insert on public.technicians
  for each row execute function app.truck_for_new_technician();

-- Purchase orders (FR-INV-05) ---------------------------------------------------------------
-- The owner sends an order themselves (email or phone); RouteVerde never
-- contacts a vendor. Totals are summed from the lines, never stored twice.

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  vendor_id uuid not null,
  number bigint,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  order_date date,
  expected_date date,
  sent_at timestamptz,
  received_at timestamptz,
  received_location_id uuid,
  notes text check (notes is null or length(notes) <= 2000),
  client_key text not null default gen_random_uuid()::text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  constraint purchase_orders_client_key unique (tenant_id, client_key),
  foreign key (tenant_id, vendor_id) references public.vendors (tenant_id, id),
  foreign key (tenant_id, received_location_id) references public.stock_locations (tenant_id, id),
  constraint sent_is_dated check (status not in ('sent', 'received') or sent_at is not null),
  constraint received_is_dated check ((status = 'received') = (received_at is not null))
);
create index purchase_orders_vendor on public.purchase_orders (tenant_id, vendor_id, created_at desc);
create index purchase_orders_location on public.purchase_orders (tenant_id, received_location_id);
create index purchase_orders_open on public.purchase_orders (tenant_id, expected_date) where status in ('draft', 'sent');

create or replace function app.number_purchase_order() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null then
    new.number := app.next_counter(new.tenant_id, 'purchase_order');
  end if;
  return new;
end
$$;
create trigger number_purchase_order before insert on public.purchase_orders
  for each row execute function app.number_purchase_order();

call app.secure_table('public.purchase_orders',
  p_select => '{owner,admin,office}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');
-- State changes (send, receive, cancel) lock the row in lib/server/inventory.ts, so no version column is needed.

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  purchase_order_id uuid not null,
  vendor_product_id uuid,
  product_id uuid not null,
  -- Copied from the vendor product when the line is written.
  package_label text not null check (length(btrim(package_label)) between 1 and 80),
  package_qty numeric(14, 6) not null check (package_qty > 0),
  package_unit text not null check (package_unit in ('fl_oz', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each')),
  packages integer not null check (packages between 1 and 100000),
  price_cents integer check (price_cents >= 0),
  received_packages integer check (received_packages between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references public.purchase_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, vendor_product_id) references public.vendor_products (tenant_id, id) on delete set null (vendor_product_id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index purchase_order_lines_order on public.purchase_order_lines (tenant_id, purchase_order_id);
create index purchase_order_lines_vendor_product on public.purchase_order_lines (tenant_id, vendor_product_id);
create index purchase_order_lines_product on public.purchase_order_lines (tenant_id, product_id);

call app.secure_table('public.purchase_order_lines',
  p_select => '{owner,admin,office}', p_insert => '{owner,admin}', p_update => '{owner,admin}', p_delete => '{owner,admin}');

-- Stock movements (FR-INV-06, FR-INV-07) ----------------------------------------------------
-- Append-only (ENG-06). qty is in `unit`; readers convert to the product's stock unit.
--   count        absolute quantity found on the shelf (qty >= 0); expected_qty is
--                what RouteVerde expected at that moment, kept for shrinkage reports
--   receive      into a location from a purchase order (qty > 0), cost_cents = what it cost
--   transfer_out / transfer_in   a pair sharing transfer_id (shop to truck restock)
--   adjust       a correction with a reason (qty <> 0)

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  location_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('count', 'receive', 'transfer_out', 'transfer_in', 'adjust')),
  qty numeric(14, 6) not null,
  unit text not null check (unit in ('fl_oz', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each')),
  expected_qty numeric(14, 6),
  cost_cents integer check (cost_cents >= 0),
  purchase_order_line_id uuid,
  transfer_id uuid,
  reason text check (reason is null or length(reason) <= 500),
  -- The business day a count belongs to (ENG-05: local date, never an offset).
  local_date date,
  occurred_at timestamptz not null default now(),
  client_key text not null check (length(client_key) between 8 and 160),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint stock_movements_client_key unique (tenant_id, client_key),
  foreign key (tenant_id, location_id) references public.stock_locations (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id),
  foreign key (tenant_id, purchase_order_line_id) references public.purchase_order_lines (tenant_id, id),
  constraint qty_sign check (
    case kind
      when 'count' then qty >= 0
      when 'receive' then qty > 0
      when 'transfer_in' then qty > 0
      when 'transfer_out' then qty < 0
      else qty <> 0
    end
  ),
  constraint count_is_dated check (kind <> 'count' or local_date is not null),
  constraint transfer_is_paired check ((kind in ('transfer_in', 'transfer_out')) = (transfer_id is not null)),
  constraint adjust_has_reason check (kind <> 'adjust' or reason is not null),
  constraint cost_only_on_receive check (cost_cents is null or kind = 'receive')
);
-- The on-hand read: per location and product, the newest count, then only the movements after it,
-- both by range on occurred_at, so cost follows the window since the last count (FR-INV-06).
create index stock_movements_ledger on public.stock_movements (tenant_id, location_id, product_id, occurred_at desc);
create index stock_movements_latest_count on public.stock_movements (tenant_id, location_id, product_id, occurred_at desc) where kind = 'count';
create index stock_movements_product on public.stock_movements (tenant_id, product_id);
create index stock_movements_counts on public.stock_movements (tenant_id, local_date, location_id) where kind = 'count';
-- The FK index test wants an index led by the FK columns, partial ones excepted.
create index stock_movements_po_line_fk on public.stock_movements (tenant_id, purchase_order_line_id);

create trigger guard_immutable before update or delete on public.stock_movements
  for each row execute function app.guard_immutable();

-- The database does not trust what a technician's phone sends (FR-INV-07, ENG-06):
-- created_at is the server clock, created_by the signed-in user, nothing is dated in the future
-- (clock skew allowance 5 minutes), and a technician's expected_qty is never stored. Their variance is
-- derived from the ledger at read time (countVariances), so a forged expectation cannot hide shrinkage.
create or replace function app.guard_stock_movement() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  if new.occurred_at > now() + interval '5 minutes' then
    raise exception 'A stock movement cannot be dated in the future' using errcode = '22008';
  end if;
  if auth.uid() is not null then
    new.created_by := auth.uid();
    if not app.has_role('{owner,admin,office,dispatcher}') then
      new.expected_qty := null;
    end if;
  end if;
  return new;
end
$$;
create trigger guard_stock_movement before insert on public.stock_movements
  for each row execute function app.guard_stock_movement();

-- Every member may read; the restrictive policy below narrows who adds what (FR-INV-06, FR-INV-07).
call app.secure_table('public.stock_movements',
  p_select => '{*}', p_insert => '{*}', p_update => '{}', p_delete => '{}');

-- receive, adjust and transfers: owner and admin (as the server). Counts: owner, admin, office, dispatcher,
-- and a technician on their own active truck.
create or replace function app.can_write_stock_movement(p_kind text, p_location_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind = 'count' then
      app.has_role('{owner,admin,office,dispatcher}')
      or exists (
        select 1
        from public.stock_locations l
        join public.technicians t on t.tenant_id = l.tenant_id and t.id = l.technician_id
        where l.tenant_id = app.current_tenant_id()
          and l.id = p_location_id
          and l.active
          and t.user_id = auth.uid()
      )
    else app.has_role('{owner,admin}')
  end
$$;

create policy technicians_count_own_truck on public.stock_movements as restrictive for insert to authenticated
  with check ((select app.can_write_stock_movement(kind, location_id)));

revoke all on all functions in schema app from public;
grant execute on function app.can_write_stock_movement(text, uuid) to authenticated, service_role;
