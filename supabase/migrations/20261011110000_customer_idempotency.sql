-- ENG-01: a double-submitted or retried new-customer form (office or a
-- technician's sale) creates one customer, one set of visits and one
-- commission. Null for customers that predate the key and for imports.
alter table public.customers add column client_key text;
alter table public.customers add constraint customers_client_key unique (tenant_id, client_key);
comment on column public.customers.client_key is 'ENG-01: per-form-render key; a retry returns the existing customer.';

-- FR-MIG-12: a row that cannot be imported is marked, with the reason in
-- `reasons`, and the rest of the file carries on.
alter table public.import_rows drop constraint import_rows_status_check;
alter table public.import_rows add constraint import_rows_status_check check (status in (
  'pending', 'valid', 'invalid', 'duplicate', 'committed', 'skipped', 'rolled_back', 'error'));
