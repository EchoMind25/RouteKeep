#!/usr/bin/env bash
# Runs the pgTAP suite in supabase/tests against a freshly migrated database.
# Same files run under `supabase test db` when the Supabase CLI stack is used.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${RK_TEST_DB:-routekeep_test}"
PORT="${RK_PGPORT:-54329}"

"$REPO_ROOT/scripts/db/local.sh" fresh "$DB"

shopt -s nullglob
files=("$REPO_ROOT"/supabase/tests/*.test.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "no pgTAP tests found" >&2
  exit 1
fi

pg_prove --ext .sql -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" --failures "${files[@]}"
