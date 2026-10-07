-- FR-BRD-03, D-14: when a business bought white label. Set only by the
-- platform (service role); members have no update grant on this column.
alter table public.tenants add column white_label_at timestamptz;
comment on column public.tenants.white_label_at is 'D-14: white label purchased; removes the product credit from everything customers see (FR-BRD-03).';
