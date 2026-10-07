# RouteKeep

Scheduling, routes, compliant application records and billing for pest control
and lawn care operators with 1 to 10 trucks. Utah first. Published month-to-month
pricing, works offline, and your data leaves whenever you want.

- What to build: [`docs/PRD.md`](docs/PRD.md) (normative). Why: [`docs/RESEARCH.md`](docs/RESEARCH.md).
- How it is built: [`replica/architecture.md`](replica/architecture.md). Clean-room record: [`docs/DESIGN_LOG.md`](docs/DESIGN_LOG.md).
- Going live: [`docs/DEPLOY.md`](docs/DEPLOY.md). Subprocessors: [`docs/VENDORS.md`](docs/VENDORS.md).

"RouteKeep" is the working name (PRD OQ-04); it lives in `lib/brand.ts` only.

## Status

| Milestone | State |
| --- | --- |
| M0 Foundation | Done. 27 tables with RLS, 567 pgTAP assertions, auth, tenant setup, CI workflows |
| M1 Core records | Done. Customers, properties, plans and subscriptions with edits, pause and cancel, one-off visits, 60-day visit generation, DST tests |
| M2 Dispatch | Done. Lanes and map, drag and drop (pointer and keyboard), queue, optimize with preview and undo, publish checks, pin confirmation. Google and VROOM optimizer adapters wait on accounts |
| M3 to M7 | Schema in place; screens not started (see `replica/build-log.md`) |

## Run it locally

Needs Node 22.12+, PostgreSQL 16 with PostGIS and pgTAP (Ubuntu:
`postgresql-16-postgis-3 postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl`).
No Supabase project or Docker required.

```bash
npm ci
cp .env.example .env.local     # then set AUTH_MODE=local, DATABASE_URL and LOCAL_AUTH_SECRET:
#   AUTH_MODE=local
#   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/routekeep
#   LOCAL_AUTH_SECRET=$(openssl rand -hex 32)
npm run db:reset               # local Postgres on :54329, migrations, demo business, 60 days of visits
npm run dev                    # http://localhost:3000, sign in with the Owner / Office / Technician buttons
```

The map has no street basemap until `NEXT_PUBLIC_MAP_STYLE_URL` is set (see
`.env.example` and `docs/DEPLOY.md` section 5); pins and routes still draw.

`AUTH_MODE=local` signs in without a password and only works against a database
on this machine; it is refused on hosted deploys. With the Supabase CLI stack
(`supabase start`) you can use real email-code sign-in instead.

## Checks

```bash
npm run check        # lint, types, unit + property tests, colour contrast
npm run test:db      # migrations + pgTAP (tenant isolation for every table, DB-01..DB-08)
npm run build && npm run test:e2e   # Playwright flows with axe accessibility scans
```

Rules every change follows are in `CLAUDE.md` (PRD section 12, clean room, tokens only, RLS only).

## Layout

```
app/                 Next.js routes: (auth), (office), (tech); (portal) and /api later
components/ui        Design-system primitives (tokens only)
components/dispatch  Board, lanes, route map          components/map  MapLibre setup, pin editor
lib/domain           Pure business logic: time zones, recurrence, units, records, money, routing
lib/server           Data access, always through withRls
lib/providers        Geocoder, RouteOptimizer; SyncProvider, Messenger, Payments later
lib/jobs             Background job bodies (generation)
supabase/migrations  Schema, RLS, constraints     supabase/tests  pgTAP
replica/             Recon map, feature matrix, architecture, design tokens, build log
tests/e2e            Playwright
docs/                PRD, research, design log, vendors, deploy
```
