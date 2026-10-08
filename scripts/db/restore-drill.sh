#!/usr/bin/env bash
# CR-09: prove a backup restores. Dumps a database, restores it into a fresh
# scratch database, and compares every table's row count. Exits non-zero on
# any difference. Locally: `npm run db:drill`. Against production, point
# SOURCE_URL at a restored Supabase backup or a read replica, never at live
# writes, and run from a machine that may hold a copy of customer data.
set -euo pipefail

SOURCE_URL="${SOURCE_URL:-postgresql://postgres@127.0.0.1:${RK_PGPORT:-54329}/routeverde}"
ADMIN_URL="${ADMIN_URL:-postgresql://postgres@127.0.0.1:${RK_PGPORT:-54329}/postgres}"
SCRATCH="routeverde_drill_$(date +%s)"
DUMP="$(mktemp -t routeverde-drill-XXXXXX.dump)"
trap 'rm -f "$DUMP"; psql "$ADMIN_URL" -qc "drop database if exists $SCRATCH" >/dev/null 2>&1 || true' EXIT

started=$(date +%s)
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$SOURCE_URL"
psql "$ADMIN_URL" -qc "create database $SCRATCH" >/dev/null
SCRATCH_URL="${ADMIN_URL%/*}/$SCRATCH"
# Roles and extensions the schema expects; errors for objects that already exist are fine.
pg_restore --no-owner --no-privileges --dbname="$SCRATCH_URL" "$DUMP" 2>/dev/null || true

counts() {
  psql "$1" -At -c "select string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text), ' ' order by c.relname)
                    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'"
}
before="$(counts "$SOURCE_URL")"
after="$(counts "$SCRATCH_URL")"
seconds=$(( $(date +%s) - started ))
size=$(du -h "$DUMP" | cut -f1)

if [[ "$before" != "$after" ]]; then
  echo "RESTORE DRILL FAILED: row counts differ"
  diff <(tr ' ' '\n' <<<"$before") <(tr ' ' '\n' <<<"$after") || true
  exit 1
fi
tables=$(tr ' ' '\n' <<<"$before" | wc -l)
echo "Restore drill passed: $tables tables, identical row counts, dump $size, ${seconds}s."
