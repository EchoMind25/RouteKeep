# Working on RouteKeep

Read `docs/PRD.md` section 0 first; it is normative and wins over everything else.
Also read `AGENTS.md`: this is Next.js 16, check `node_modules/next/dist/docs/`
before using an API from memory.

## Rules (PRD section 12 and the clean-room rule, condensed)

- Reference requirement IDs (FR-, CR-, DB-, ENG-...) in commits, tests and comments.
- Clean room: never copy competitor code, UI, copy or screenshots; never use their
  logins or APIs. Log how each feature was derived in `docs/DESIGN_LOG.md`.
- Request code reaches the database only through `withRls` (`lib/db/rls.ts`).
  `withServiceRole` is for jobs and webhooks; ESLint blocks it in `app/` and `components/`.
- Every new table goes through `app.secure_table(...)` in its migration, gets a
  row in `pg_temp.seed_tenant` (`supabase/tests/_helpers.psql`), and composite
  `(tenant_id, x_id)` foreign keys. `npm run test:db` fails otherwise.
- Retryable writes carry a client key with a unique constraint (ENG-01). Money is
  integer cents; the ledger is append-only (ENG-06). Store local date + local time
  + IANA zone, never offsets (ENG-05).
- Colours, radii and type come from tokens only (`replica/design/tokens.json`,
  regenerate with `npm run design:tokens`). Icons from Phosphor. No em dashes in UI copy.
- Unfinished user-visible features stay behind `lib/flags.ts` (ENG-10).
- Configuration is read only in `lib/env.ts` (server) and `lib/public-env.ts`.
- No new paid service or vendor without updating PRD section 4 and the owner's approval.

## Commands

```bash
npm run db:reset     # local Postgres :54329 + migrations + demo data + visits
npm run dev          # AUTH_MODE=local in .env.local for password-free dev sign-in
npm run check        # lint, typecheck, unit/property tests, contrast
npm run test:db      # pgTAP
npm run db:types     # regenerate lib/db/schema.ts after a migration
npm run build && npm run test:e2e
```

## Usage policy (opus-saver, `.claude/README.md`)

Search and summaries go to `scout`, mechanical edits and test runs to `scribe`,
specified builds to `builder`; design, debugging and final review stay on the
main model. Under about three tool calls, do it directly. Every brief repeats
the hard rules above in its Constraints line.
