---
name: route-by-tier
description: Decide whether work stays on the main model or goes to scout (Haiku), scribe (Haiku) or builder (Sonnet), and how to brief them. Use before multi-file reads, mechanical edits, or implementation that already has a clear spec.
---

# Route work by tier

The goal is to keep the main model on decisions and send volume work to cheaper models.

## Routing table

| Work | Where it goes |
| --- | --- |
| "Where is X", "what calls Y", summarize a file, log or diff, check what a config says | `scout` (Haiku, read-only) |
| Renames, formatting, boilerplate, comments, docs, changelog, commit messages, simple config edits, running tests or builds and reporting failures | `scribe` (Haiku) |
| Feature or fix with named files and a done condition, writing tests, moderate refactor | `builder` (Sonnet) |
| Architecture and design choices, debugging with no repro, security-sensitive review, cross-cutting refactors, anything whose spec is still forming, final review of subagent output | Stay on the main model |

## When not to delegate

- The task is about three tool calls or fewer. Spawn overhead costs more than it saves.
- The brief would need more than about 120 words of conversation context to be safe.
- The result would force a re-read of every file the subagent touched, which cancels the saving.
- A run of many tiny dependent edits. Batch them into one brief instead.

## Brief template

Send every subagent the same five lines:

```
Goal: <one sentence>
Files: <paths, or where to look>
Constraints: <conventions, things not to touch, style rules from the user>
Done when: <observable condition, ideally a command that passes>
Return: <the report format the agent already uses, plus anything extra>
```

Subagents start with no conversation history. Anything the user said that matters (naming rules, "no em dashes", framework choices) has to be in Constraints.

## After the subagent returns

- Read the report, not the files. Spot-check with `git diff --stat` or one targeted read of the riskiest change.
- If a report ends in `NEEDS_OPUS`, take the task over using the facts it returned. Do not re-delegate the same brief.
- If two subagents are independent, brief them in the same turn so they run in parallel.

## Reminder about cost

Each subagent pays for its own startup context. A large CLAUDE.md is loaded into every non-read-only subagent, so keep it short.
