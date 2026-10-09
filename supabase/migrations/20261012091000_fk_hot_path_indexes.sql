-- Foreign-key and hot-path indexes. PRD: DB-05, ENG-08, NFR-03.
-- Parent deletes and "rows for this visit" lookups scan these tables otherwise.
create index messages_appointment on public.messages (tenant_id, appointment_id) where appointment_id is not null;
create index invoice_lines_appointment on public.invoice_lines (tenant_id, appointment_id) where appointment_id is not null;
create index agreements_appointment on public.agreements (tenant_id, appointment_id) where appointment_id is not null;
create index sync_conflicts_appointment on public.sync_conflicts (tenant_id, appointment_id) where appointment_id is not null;
create index applications_tech_recent on public.applications (tenant_id, technician_id, applied_at) include (product_id);
