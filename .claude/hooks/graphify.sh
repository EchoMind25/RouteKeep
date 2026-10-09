#!/usr/bin/env bash
# Keeps the Graphify knowledge graph current for every Claude Code session.
#   start  SessionStart: refresh in the background, tell the session how to use it.
#   edit   PostToolUse on Edit/Write: queue a background incremental refresh.
#   guard  PreToolUse on search/read: graphify's own nudge toward the graph.
# Never blocks a tool call and never fails the session: every path exits 0.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
export PATH="$HOME/.local/bin:$PATH" GRAPHIFY_QUERY_LOG_DISABLE=1

out=graphify-out
lock="$out/.refresh.lock"

refresh_in_background() {
  mkdir -p "$out"
  touch "$out/.dirty"
  # One refresher at a time; it loops until no edit arrived during its last run.
  if mkdir "$lock" 2>/dev/null; then
    (
      while [ -f "$out/.dirty" ]; do
        rm -f "$out/.dirty"
        bash scripts/graph/refresh.sh >>"$out/refresh.log" 2>&1 || true
      done
      rmdir "$lock"
    ) </dev/null >/dev/null 2>&1 &
  fi
}

case "${1:-}" in
  start)
    # A lock older than ten minutes belongs to a killed refresher.
    find "$lock" -maxdepth 0 -mmin +10 -exec rmdir {} \; 2>/dev/null
    refresh_in_background
    cat <<'TXT'
Graphify knowledge graph: graphify-out/graph.json (code, SQL migrations, docs, plus RouteVerde links from code to DB tables and to PRD requirement IDs). It refreshes in the background now and after every edit; a fresh clone takes about 30 seconds (progress in graphify-out/refresh.log).
Navigate the graph before reading files: graphify query "<question>", graphify explain "<symbol or table invoices or CR-01>", graphify path "<A>" "<B>". Read source files only for the lines the graph points to.
TXT
    ;;
  edit)
    cat >/dev/null
    refresh_in_background
    ;;
  guard)
    command -v graphify >/dev/null 2>&1 && [ -f "$out/graph.json" ] && graphify hook-guard "${2:-read}"
    ;;
esac
exit 0
