# Architecture

Reads `replica/recon.md` and `docs/PRD.md` (normative). Last updated 2026-10-06.

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | One Next.js 16 app (App Router, TypeScript strict) for office, technician PWA, portal and API | D-01: one deployable for a solo builder |
| Styling | Tailwind v4, every colour a token from `replica/design/tokens.json` (default palette removed) | Tokens-only rule; rebrand changes values, not code |
| Components | Own primitives on Radix (dialog, slot), Phosphor icons, Geist fonts (bundled, no font CDN) | Accessible base, privacy (no third-party font requests) |
| Database | Supabase Postgres + PostGIS, RLS on every table | D-02 |
| Data access | Kysely over `pg`, queries wrapped in `withRls` (role `authenticated` + verified JWT claims) | Typed SQL with transactions; RLS still applies. PRD allows drizzle or kysely; kysely keeps SQL migrations the single source of truth (types are generated from them) |
| Auth | Supabase Auth, email one-time code; MFA available later (CR-15) | Code entry works inside an installed iOS PWA, where magic links open Safari instead |
| Jobs | Inngest (durable steps) for generation, billing, messaging, import | D-04: nothing over 20 s in a request |
| Offline | PowerSync behind a `SyncProvider` interface (M3) | D-06 |
| Routing | `RouteOptimizer` interface: Google single-vehicle first, VROOM later (M2) | D-07 |
| Maps | MapLibre with open tiles; Google Geocoding behind `Geocoder` (address only) | D-08, NFR-08 |
| Payments | Stripe Connect, Standard-style accounts, direct charges, hosted fields (M4) | D-09, CR-05 |
| Email / SMS | Resend; Twilio only after tenant 10DLC approval (M6) | D-10, CR-07 |
| Hosting | Netlify Free; nothing Netlify-specific outside `/infra/netlify` | D-03 |
| Tests | Vitest + fast-check (domain), pgTAP (RLS, constraints), Playwright + axe (flows, WCAG 2.2 AA) | ENG-11, CR-10, NFR-05 |

TypeScript is pinned at 6.0.3, not the latest 7.0.2: TS 7 ships only the native compiler without the JavaScript API that typescript-eslint and Next's type check need. Revisit when typescript-eslint supports 7.

## 2. Tenancy and security model

- Every tenant table has `tenant_id` and `unique (tenant_id, id)`. Every foreign key between tenant tables is composite: `(tenant_id, parent_id) references parent (tenant_id, id)`. Foreign key checks bypass RLS in Postgres, so without this a row in tenant A could reference a row in tenant B. With it, that is impossible by construction (tested in `002-tenant-isolation`).
- `app.current_tenant_id()` trusts the JWT's `tenant_id` claim only while an active membership backs it. Revoking or demoting a member takes effect on their next query, not when the token expires.
- `app.secure_table()` is the only way tables are created: it enables RLS, revokes Supabase's default grants (including TRUNCATE, which bypasses RLS) and grants per-operation privileges by role, with restrictive policies for role checks.
- Column-level grants close the gaps RLS cannot: members cannot change a tenant's plan or Stripe status, cannot mark a card payment as paid, cannot edit invoice totals.
- The Supabase Data API is not used by the app (it talks to Postgres directly), so it can be switched off for the `public` schema in the dashboard. RLS and grants are written so that leaving it on is still safe.
- Request code reaches the database only through `withRls`. `withServiceRole` (bypasses RLS) is restricted by ESLint to jobs, webhooks and the local-auth bootstrap.
- Recommended production connection: a `routekeep_app` login role that is a member of `authenticated` and `service_role` but owns nothing, so a query that forgets to switch roles fails closed (see `docs/DEPLOY.md`).

## 3. Schema

27 tables in `supabase/migrations`, all with RLS (pgTAP: 561 assertions).

| Area | Tables | Notable constraints |
| --- | --- | --- |
| Tenancy | tenants, offices, memberships, technicians | IANA zone FK (ENG-05), last-owner guard, license required (FR-SET-02) |
| CRM | customers, properties | SMS consent needs time and source (CR-07); locked pins cannot move (R-BUG-05); trigram search |
| Scheduling | service_types, service_plans, products, subscriptions, appointments, routes | plan terms copied at sale; `unique (tenant, subscription, occurrence_date)` makes generation idempotent; `unique (tenant, client_key)` (DB-05); version column (ENG-07) |
| Records | applications, agreements, attachments | CR-01 completeness is a CHECK; 24 h lock from server receipt (DB-08); amendments are new rows; no deletes (CR-04) |
| Billing | invoices, invoice_lines, payments, ledger_entries (+ views) | DB-01, DB-02, DB-07; invoice total = sum of lines at commit; ledger sign rules; idempotent `entry_key` |
| Messaging | outbox_events, messages, webhook_events | DB-03, DB-04; usage ledger (FR-MSG-05) |
| Migration | import_mappings, import_jobs, import_rows, exports | shared presets as data (FR-MIG-01); every imported row points to its job for rollback |
| Audit | audit_log | written by a SECURITY DEFINER trigger on financial and compliance tables; append-only (CR-12) |

Deviations from PRD section 7, each for a stated reason:
- `tenants` has no `tenant_id` (it is the tenant). `webhook_events.tenant_id` and `import_mappings.tenant_id` are nullable: platform-level Stripe events and shared presets belong to no tenant.
- Applications store a snapshot of every CR-01 field (names, addresses, licence numbers, product label data) so later edits never rewrite a legal record.
- `ledger_entries` has explicit `invoice_id` / `payment_id` foreign keys and an `entry_key` instead of a generic `ref`.
- Products have a `kind` including `minimum_risk` (FIFRA 25(b) products carry no EPA number).
- Money is integer cents without a currency column: tenants are US-only (PRD non-goal: non-US tenants).

## 4. Server surface (M0-M1)

Server Actions, each validating with zod and running inside `withRls`:

| Action | Flow | Who | Writes |
| --- | --- | --- | --- |
| `startSignIn`, `verifyCode`, `signOut` | F01 | anyone | auth session |
| `createBusiness` | F01 | signed-in user | `app.create_tenant` (tenant, office, owner membership, default service types) |
| `createCustomerAction` | F02 | owner, admin, office, dispatcher (plan: not dispatcher) | customer, property, subscription, generated appointments |
| `updateBusiness` | S14 | owner, admin | tenant, primary office |
| `inviteMemberAction` | S14 | owner, admin (owner for owner/admin roles) | auth user (Supabase admin invite), `app.add_member` |
| `createTechnician`, `createPlan`, `setPlanActive`, `createProduct` | S14 | owner, admin | catalog tables |

Background jobs (Inngest, served at `/api/inngest`):

| Function | Trigger | Does |
| --- | --- | --- |
| `generation-nightly` | cron 02:15 America/Denver | lists tenants, emits one `generation/tenant.requested` event each (fan-out: one tenant cannot block another) |
| `generation-tenant` | `generation/tenant.requested`, concurrency 1 per tenant, 4 retries | `lib/jobs/generate-appointments.ts` in steps of 400 subscriptions; inserts are idempotent so retries are safe; ends bounded pauses |

Visit-level and plan-level actions added in M1: `rescheduleAction`, `skipAction`, `cancelAction`, `restoreAction` (single visit, version-checked); `changeSeriesAction`, `pauseAction`, `resumeAction`, `cancelPlanAction`, `reactivateAction` (series, version-checked, row-locked); `createVisitAction` (one-off, client key); `updateCustomerAction`, `savePropertyAction`.

Planned routes: `/api/inngest` (job runner), `/api/webhooks/stripe` (M4), `/api/webhooks/resend|twilio` (M6), PowerSync upload endpoint (M3).

## 5. The parts that bite

- Time zones and DST: dates and wall times are stored without offsets; conversion to instants happens only for reminders and is property-tested across seven zones. Recurrence expands on calendar dates, never instants.
- Idempotency: every retryable write has a client key with a unique constraint; generation, ledger posting and webhook intake are all upserts or dedupes.
- Concurrency: version columns bumped by trigger; no-op updates and job bookkeeping (`generated_through`) do not count as edits.
- Offline (M3): the hardest part; PowerSync, local-first reads, persisted drafts, upload queue, conflict review queue (NFR-02).
- Money (M4): Stripe idempotency keys from row ids, webhook dedupe, ledger as the only source for balances and reports.
- Multi-tenancy: composite foreign keys plus RLS plus grants, all tested per table.

## 6. Build order

| Milestone | Screens | Status |
| --- | --- | --- |
| M0 Foundation | S01, S02 | Done: schema, RLS, pgTAP, auth, tenant setup, CI |
| M1 Core records | S03, S06, S07, S08, S14 | Done: customers, properties, plans, subscriptions, generation, DST tests. Remaining: subscription edits (FR-SUB-03), one-off visits (FR-SUB-04), pin confirmation map (FR-CRM-02 needs M2 map) |
| M2 Dispatch | S04 board, S05, S09 | Day lanes and queue built; map, drag, optimizer next |
| M3 Technician PWA | S17, S18 | Online day list as a stopgap |
| M4 Money | S11, S12 | Schema and constraints in place |
| M5 Migration and export | S15, S16 | Schema in place |
| M6 Messaging and portal | S19, S20 | Schema in place |
| M7 Pilot hardening | legal pages, status page, restore drill | Not started |
