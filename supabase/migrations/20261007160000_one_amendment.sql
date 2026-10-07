-- FR-REC-03, FR-REC-06: a record is amended at most once. A later correction
-- amends the amendment, so every record has exactly one current version (the
-- end of its chain) and reports count each application once. The index also
-- answers "has this record been amended?" for the usage report.
create unique index applications_one_amendment on public.applications (tenant_id, amended_from) where amended_from is not null;
