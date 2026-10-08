---
name: intent-check
description: Restate an ambiguous request, surface the assumptions that matter, and ask at most one clarifying question before acting. Use when a prompt is vague, refers to something with no antecedent, or an "Intent check" note is present.
---

# Intent check

Run this before any tool call when the request could be read two ways that lead to different work.

## Procedure

1. **Restate.** One sentence: "You want X, applied to Y, so that Z." Use the user's own nouns.
2. **Look for the answer first.** Earlier turns, the open file, git status and the project layout often resolve a vague prompt. If they do, proceed and mention the assumption in half a sentence.
3. **Test the gap.** Ask: would the two readings touch different files, build different behavior, or take very different effort? If no, pick the likelier reading, say so, and proceed.
4. **Ask once.** If the gap matters, ask exactly one question, with two or three concrete options and a default, under 30 words. Then stop and wait.

## What a good question looks like

- "Do you mean the Apps Script trigger (runs nightly) or the n8n workflow? I'll assume the Apps Script trigger unless you say otherwise."
- "Fix the failing test in `tests/auth.test.ts`, or the login bug it exposes? Default: the bug."

## What to avoid

- More than one question.
- Questions whose answer is in the repo.
- Asking about style, naming or formatting when the codebase already shows a convention.
- Restating the request at length. One sentence.

## Bypass

The user can put `[go]` anywhere in a prompt to skip this check, or `[check]` to force it.
