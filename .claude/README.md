# Claude Code setup for this repo: opus-saver

Installed 2026-10-08 from the owner's `opus-saver` plugin (v0.1.0, MIT), as
project files rather than a marketplace plugin, so every session in this repo
(cloud or local) gets it with no install step.

| What | Where | Does |
| --- | --- | --- |
| Agents `scout` (Haiku, read-only), `scribe` (Haiku), `builder` (Sonnet) | `agents/` | Volume work off the main model |
| Skills `route-by-tier`, `intent-check` | `skills/` | When to delegate and the five-line brief; one-question check for vague prompts |
| SessionStart hook | `hooks/session-policy.sh` | Re-injects the routing policy at start, resume, clear and compact |
| UserPromptSubmit hook | `hooks/intent-gate.sh` | Local vagueness heuristic; silent for clear prompts. `[go]` skips it, `[check]` forces it |

Test the gate: `bash .claude/hooks/test-intent-gate.sh`.

Briefs to `scribe` and `builder` must carry this repo's hard rules in
Constraints (they read CLAUDE.md, but the brief is what they act on): RLS
through `withRls`, `secure_table` plus a seed row for new tables, integer
cents, tokens only, no em dashes in UI copy, requirement IDs in comments.
The main model reviews their diff and runs `npm run check` before committing.
