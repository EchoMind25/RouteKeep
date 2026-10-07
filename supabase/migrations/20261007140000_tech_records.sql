-- Technician app records (M3): who signed for a visit. The signature image is
-- an attachment (kind 'signature'); the name the customer gave is kept here.
-- PRD: FR-TEC-03, FR-TEC-09, FR-REC-02.

alter table public.appointments
  add column signer_name text check (signer_name is null or length(btrim(signer_name)) between 1 and 120);

revoke all on all functions in schema app from public;
