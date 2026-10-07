-- Technician app (M3): what the technician notes and checks at a stop, and the
-- office's review queue for work captured offline against a visit that changed
-- in the meantime. PRD: FR-TEC-03, NFR-02.

alter table public.appointments
  add column tech_notes text check (tech_notes is null or length(tech_notes) <= 4000),
  add column checklist_results jsonb check (checklist_results is null or jsonb_typeof(checklist_results) = 'array');

-- NFR-02: server wins on schedule fields, the device wins on field-captured
-- records. When the two collide (a stop completed offline after the office
-- cancelled or reassigned it), the records are kept and a row lands here for a
-- person to decide what the visit should say.
create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.current_tenant_id() references public.tenants (id) on delete cascade,
  appointment_id uuid not null,
  technician_id uuid,
  kind text not null check (kind in ('completed_after_change', 'skipped_after_change')),
  -- What the device did and what the server had, for the reviewer.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  client_key text not null check (length(client_key) between 8 and 128),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text check (resolution is null or length(resolution) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint sync_conflicts_client_key unique (tenant_id, client_key),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id),
  foreign key (tenant_id, technician_id) references public.technicians (tenant_id, id),
  constraint resolved_together check ((resolved_at is null) = (resolved_by is null))
);
create index sync_conflicts_open on public.sync_conflicts (tenant_id, created_at) where resolved_at is null;

-- Any member's upload may raise one and may read them (an idempotent
-- `insert ... on conflict do nothing` must be able to see the row it guards);
-- only the office resolves them.
call app.secure_table('public.sync_conflicts',
  p_select => '{*}',
  p_insert => '{*}',
  p_update => '{owner,admin,office,dispatcher}',
  p_delete => '{}');

revoke all on all functions in schema app from public;
