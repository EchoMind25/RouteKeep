#!/usr/bin/env bash
# Builds or incrementally refreshes the Graphify knowledge graph in graphify-out/.
# Local only: code and SQL are parsed with tree-sitter, Markdown by heading
# structure, and scripts/graph/link-domain.mjs adds table and requirement edges.
# No LLM call and no API key. Unchanged files are skipped by SHA256 cache.
#   npm run graph            refresh (first run builds from scratch)
#   npm run graph -- --force rebuild even if the graph would shrink (after deletions)
set -euo pipefail
cd "$(dirname "$0")/../.."

GRAPHIFY_VERSION="0.9.82"
export GRAPHIFY_QUERY_LOG_DISABLE=1 GRAPHIFY_NO_TIPS=1 GRAPHIFY_NO_AUTO_REFRESH=1
export PATH="$HOME/.local/bin:$PATH"

if ! command -v graphify >/dev/null 2>&1; then
  # PyPI package is graphifyy (double y); source github.com/Graphify-Labs/graphify.
  pkg="graphifyy[sql]==$GRAPHIFY_VERSION"
  if command -v uv >/dev/null 2>&1; then
    uv tool install -q "$pkg"
  elif command -v pipx >/dev/null 2>&1; then
    pipx install -q "$pkg"
  else
    python3 -m pip install -q --user "$pkg" || python3 -m pip install -q --user --break-system-packages "$pkg"
  fi
fi

installed="$(graphify --version 2>/dev/null | awk '{print $2}')"
if [ "$installed" != "$GRAPHIFY_VERSION" ]; then
  echo "[graph] note: graphify $installed installed, repo is pinned to $GRAPHIFY_VERSION" >&2
fi

force=""
[ "${1:-}" = "--force" ] && force="--force"
# The shrink guard refuses a smaller graph; after files are deleted that is expected.
graphify update . $force || graphify update . --force
node scripts/graph/link-domain.mjs
