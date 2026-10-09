#!/usr/bin/env bash
# Local Postgres for development and tests. Plain Postgres + PostGIS + pgTAP,
# with scripts/db/supabase-shim.sql standing in for Supabase's roles and auth
# helpers. If you run the Supabase CLI stack instead (`supabase start`), you do
# not need this script: point DATABASE_URL at that stack and use `supabase db reset`.
#
#   scripts/db/local.sh start            init (first run) and start the cluster
#   scripts/db/local.sh stop
#   scripts/db/local.sh status
#   scripts/db/local.sh reset [db]       drop, recreate, migrate, seed (default db: routeverde)
#   scripts/db/local.sh migrate [db]     apply pending migrations
#   scripts/db/local.sh fresh <db>       drop, recreate, migrate, no seed (used by tests)
#   scripts/db/local.sh psql [db]
#
# Environment: RK_PGPORT (default 54329), RK_PGDATA (default .local/pg in the repo,
# or /var/lib/postgresql/routeverde-dev when run as root).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${RK_PGPORT:-54329}"
HOST="127.0.0.1"

if [[ -n "${RK_PGBIN:-}" ]]; then
  PGBIN="$RK_PGBIN"
else
  # Newest installed server that also has PostGIS (runners can carry several versions).
  PGBIN=""
  for dir in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -rV); do
    version="$(basename "$(dirname "$dir")")"
    if [[ -f "/usr/share/postgresql/$version/extension/postgis.control" ]]; then
      PGBIN="$dir"
      break
    fi
  done
fi
if [[ -z "$PGBIN" || ! -x "$PGBIN/pg_ctl" ]]; then
  echo "Postgres server binaries not found. Install postgresql-16, postgresql-16-postgis-3, postgresql-16-pgtap." >&2
  exit 1
fi

if [[ $EUID -eq 0 ]]; then
  # initdb refuses to run as root; run the server as the postgres OS user.
  DATA_DIR="${RK_PGDATA:-/var/lib/postgresql/routeverde-dev}"
  as_pg() { runuser -u postgres -- "$@"; }
else
  DATA_DIR="${RK_PGDATA:-$REPO_ROOT/.local/pg}"
  as_pg() { "$@"; }
fi

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U postgres)

is_running() { as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; }

cmd_start() {
  if [[ ! -s "$DATA_DIR/PG_VERSION" ]]; then
    mkdir -p "$DATA_DIR"
    [[ $EUID -eq 0 ]] && chown postgres:postgres "$DATA_DIR"
    as_pg "$PGBIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    cat >>"$DATA_DIR/postgresql.conf" <<EOF
listen_addresses = '$HOST'
port = $PORT
unix_socket_directories = '$DATA_DIR'
timezone = 'UTC'
log_min_messages = warning
fsync = off
synchronous_commit = off
full_page_writes = off
EOF
  fi
  if ! is_running; then
    as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$DATA_DIR/server.log" -w start >/dev/null
  fi
  echo "postgres running on $HOST:$PORT (data: $DATA_DIR)"
}

cmd_stop() { is_running && as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null; echo "stopped"; }

cmd_status() { if is_running; then echo "running on $HOST:$PORT"; else echo "stopped"; fi; }

recreate_db() {
  local db="$1"
  "${PSQL[@]}" -d postgres -c "drop database if exists \"$db\" with (force)" -c "create database \"$db\""
  "${PSQL[@]}" -d postgres -c "alter database \"$db\" set search_path = \"\$user\", public, extensions" \
    -c "alter database \"$db\" set timezone = 'UTC'"
}

apply_migrations() {
  local db="$1"
  "${PSQL[@]}" -d "$db" -f "$REPO_ROOT/scripts/db/supabase-shim.sql"
  "${PSQL[@]}" -d "$db" -c "create schema if not exists supabase_migrations" \
    -c "create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, applied_at timestamptz not null default now())"
  local file base version name applied=0
  for file in "$REPO_ROOT"/supabase/migrations/*.sql; do
    base="$(basename "$file" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    if [[ -n "$("${PSQL[@]}" -d "$db" -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ]]; then
      continue
    fi
    "${PSQL[@]}" -d "$db" --single-transaction -f "$file" \
      -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
    applied=$((applied + 1))
  done
  echo "migrations applied to $db: $applied"
}

cmd_reset() {
  local db="${1:-routeverde}"
  cmd_start >/dev/null
  recreate_db "$db"
  apply_migrations "$db"
  if [[ -f "$REPO_ROOT/supabase/seed.sql" ]]; then
    "${PSQL[@]}" -d "$db" -f "$REPO_ROOT/supabase/seed.sql"
    echo "seed applied to $db"
  fi
}

cmd_fresh() {
  local db="${1:?database name required}"
  cmd_start >/dev/null
  recreate_db "$db"
  apply_migrations "$db"
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  reset) cmd_reset "${2:-}" ;;
  fresh) cmd_fresh "${2:-}" ;;
  migrate) cmd_start >/dev/null; apply_migrations "${2:-routeverde}" ;;
  psql) cmd_start >/dev/null; exec psql -X -h "$HOST" -p "$PORT" -U postgres -d "${2:-routeverde}" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
