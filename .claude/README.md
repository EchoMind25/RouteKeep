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

## Plugins and vendored skills (added 2026-10-08)

Declared in `settings.json` (`extraKnownMarketplaces` + `enabledPlugins`), so
cloud and local sessions in this repo install them on trust of the folder.

| Plugin | Source | Leaves the machine? |
| --- | --- | --- |
| `claude-code-setup` | `anthropics/claude-plugins-official` | No. Skill only; recommends hooks, skills, subagents, MCP servers |
| `claude-md-management` | `anthropics/claude-plugins-official` | No. Skill + `/revise-claude-md` command for keeping CLAUDE.md current |
| `agent-skills` | `addyosmani/agent-skills` (MIT) | No. 25 skills, 4 agents, commands. Its optional hooks are not registered |
| `claude-mem` | `thedotmack/claude-mem` (Apache-2.0) | Yes, see below |

`claude-mem` runs a local worker and stores memory in `~/.claude-mem` (SQLite).
Observations are compressed by an LLM provider, `claude` by default (the
Anthropic API, same vendor as Claude Code). PostHog usage telemetry is on by
default upstream; `env.CLAUDE_MEM_TELEMETRY=0` here turns it off. Cloud sync to
cmem.ai is off unless `CLAUDE_MEM_CLOUD_SYNC_HUB_URL` is set; leave it empty.
In cloud sessions `~/.claude-mem` is wiped with the container, so memory only
persists on a local machine.

Vendored skills (copied verbatim, not plugins upstream):

| Skill | Source | Note |
| --- | --- | --- |
| `convert-documents-to-markdown` (AnyDoc) | `firecrawl/anydoc` @ `261fc25` (MIT) | Runs `npx -y @firecrawl/anydoc` locally. Never pass `--ocr hosted`: it uploads the file to Firecrawl |
| `find-skills` | `vercel-labs/skills` @ `87a2669` (MIT) | `npx skills find` sends the search query to the skills.sh registry |
