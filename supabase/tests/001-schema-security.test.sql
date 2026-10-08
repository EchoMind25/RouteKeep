-- Structural security invariants that must hold for every table, view and
-- function, including ones added later. PRD: CR-10, ENG-08.
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select no_plan();

select ok(c.relrowsecurity, format('%s: row level security is enabled', c.relname))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

select has_column('public', t, 'tenant_id', format('%s: carries tenant_id', t))
from pg_temp.tenant_tables() t
where t <> 'tenants';

-- Only shared import presets and platform webhooks may lack a tenant.
select col_not_null('public', t, 'tenant_id', format('%s: tenant_id is not null', t))
from pg_temp.tenant_tables() t
where t not in ('tenants', 'import_mappings', 'webhook_events');

select ok(
  not has_table_privilege('anon', c.oid, p),
  format('%s: anon has no %s privilege', c.relname, p)
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
where n.nspname = 'public' and c.relkind in ('r', 'v');

select ok(
  not has_table_privilege('authenticated', c.oid, p),
  format('%s: authenticated has no %s privilege', c.relname, p)
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join unnest(array['truncate', 'references', 'trigger']) p
where n.nspname = 'public' and c.relkind = 'r';

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and roles <> '{authenticated}'
     and not (roles = '{portal}' and policyname like 'portal\_%')),
  0,
  'every policy applies to the authenticated role only, apart from the portal''s own (M6)'
);

select ok(
  coalesce(c.reloptions @> '{security_invoker=true}', false),
  format('view %s runs with the caller''s permissions (RLS applies)', c.relname)
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v';

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  0,
  'every security definer function pins its search_path'
);

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
  0,
  'no function in the private app schema is executable by PUBLIC'
);

select ok(
  not has_function_privilege(r, 'public.custom_access_token_hook(jsonb)', 'execute'),
  format('the access token hook is not callable by %s', r)
)
from unnest(array['anon', 'authenticated']) r;

select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'the auth server can call the access token hook'
);

select * from finish();
rollback;
