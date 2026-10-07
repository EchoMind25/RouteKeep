-- FR-BRD-02: the business's logo, in the private bucket. Owners and admins set
-- it (tenant_self_update already limits updates to them).
alter table public.tenants add column logo_path text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/branding/logo\.(png|jpg)$');
grant update (logo_path) on table public.tenants to authenticated;
