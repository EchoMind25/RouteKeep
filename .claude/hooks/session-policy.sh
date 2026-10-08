#!/usr/bin/env bash
# SessionStart hook. Plain stdout is added to the session context.
# Fires on startup, resume, clear and compact, so the policy survives compaction.
cat <<'EOF'
opus-saver is installed. Its purpose is to cut main-model usage, so delegating well-specified work to its subagents is the intended pattern.
Subagents: scout (Haiku, read-only search and summaries), scribe (Haiku, mechanical edits and running checks), builder (Sonnet, implementation with a clear spec and done condition).
Work that stays on the main model: design decisions, debugging without a repro, security-sensitive review, and final review of subagent output.
Tasks of about three tool calls or fewer are cheaper to do directly. Each brief to a subagent has five lines: Goal, Files, Constraints, Done when, Return. The route-by-tier skill has the full table.
A prompt followed by an "Intent check" note was flagged by a local heuristic as possibly underspecified.
EOF
