# Product analytics: data-collection contract

Opt-in at both levels: a business shares nothing until an owner or admin
chooses to, and the browser reporter also needs each person's own yes in the
cookie banner.

Normative for OPS-03 and OPS-04 (docs/PRD.md section 8.10.3). If code and this
file disagree, the code is wrong. A change to what is collected changes this
file, the public Privacy Policy and `lib/telemetry/events.ts` in the same PR.

Where it lives:
- Schema, gate, retention and console functions:
  `supabase/migrations/20261014090000_product_analytics.sql`
- Business setting: Settings > Business > "Product improvement data", and the
  onboarding question at the top of `/setup` until an owner or admin answers
  (`app/(office)/settings/data-sharing/`, wording in `lib/domain/data-sharing.ts`)
- Answer time: the same migration's `app.apply_data_sharing` trigger stamps `data_sharing_changed_at` on every explicit save, so choosing `none`
  on purpose counts as answered
- Developer console section "Product signals": `app/(developer)/developer/page.tsx`,
  `lib/ops/console.ts`, `lib/ops/console-model.ts`
- Tests: `supabase/tests/013-product-analytics.test.sql`, `lib/ops/console-model.test.ts`,
  `lib/domain/data-sharing.test.ts`

## 1. The business setting

Each business (tenant) has one setting, `tenants.data_sharing`, changed by an owner or admin in Settings > Business > "Product improvement data".

| Level | What RouteVerde stores | Linked to the business? |
|---|---|---|
| `none` (default) | Nothing. No product events and no error reports from that business's office app, technician app or customer portal. The browser reporter is not loaded, and the server drops any event before it reaches the database. | n/a |
| `anonymous` | Product events and scrubbed error reports, with no business id, no user id, no customer data. | No. Rows cannot be traced back to the business, even by us. |
| `identified` | The same events, plus the business id, so we can see which business hit a problem and help them. | Yes, business only. Never a person. |

Opt-in (owner decision, 2026-10-09): every business starts at `none`, including businesses that exist before this ships. The owner is asked as one of the first onboarding questions, with the plain outline below of exactly what is tracked and how it helps; skipping leaves `none`. Plain copy for onboarding:
- Don't share anything: RouteVerde stores no usage or error data from your business.
- Share anonymously: when something breaks, or when your team changes a suggested route, we record what happened with no business name, no people and no customer data, so we can fix errors faster and make auto routes match how you really drive.
- Share with our business name: the same, plus your business name, so we can spot a problem you are having and reach out before you have to.

Server-side gate: every event passes through one database function (`app.track_event`) that reads the business's current setting at insert time. The app cannot bypass it; the events table has no direct insert grant for any API role.

Changing the setting:
- to `none`: collection stops immediately, and every stored event that carries the business id is deleted.
- from `identified` to `anonymous`: collection continues anonymously, and the business id is removed from every past event.
- anonymous events already stored cannot be deleted per business, because nothing links them to the business. Say this plainly in the policy.
- the change is recorded with time (`data_sharing_changed_at`, null means not answered yet) and, through the tenants audit trigger, the member who made it.

Business deleted: its identified events are deleted with it.

## 2. What is never collected, at any level

- Customer names, addresses, emails, phone numbers, notes, message bodies, photos, signatures, payment details.
- User ids, technician names, emails, IP addresses, precise location, device ids, advertising ids.
- Free text typed by anyone. Error messages are scrubbed (emails, phone numbers, long digit runs, ids, quoted values, names and street addresses removed) and cut to 200 characters.
- No cookies, no localStorage, no fingerprinting. The reporter keeps a per-page-load in-memory counter only.
- No third-party analytics or error SDK. Everything is stored in RouteVerde's own Supabase Postgres.

## 3. What an event contains

| Field | Notes |
|---|---|
| `name` | From a fixed catalog in code (`lib/telemetry/events.ts`). Unknown names are rejected. |
| `props` | Only keys the catalog allows for that name; numbers, booleans and short fixed strings (enums, route patterns like `/customers/:id`). Max 2 KB. |
| `surface` | `office`, `tech`, `portal`, `public`, `server` or `job`. |
| `app_version` | Build id of the deployed app. |
| `hour` | Time truncated to the hour. No exact timestamps. |
| `tenant_id` | Only at `identified`. Null otherwise. |

## 4. Event catalog v1

| Name | When | Props |
|---|---|---|
| `error.client` | A page crashes or a script error/unhandled promise rejection in the browser | `kind`, `fingerprint`, `message` (scrubbed), `route` (pattern) |
| `error.server` | A server request fails | `kind`, `fingerprint`, `message` (scrubbed), `route` (pattern), `digest` |
| `route.proposal_shown` | The dispatcher previews an auto route (solver or AI planner) | `engine`, `stops`, `saved_minutes` |
| `route.proposal_accepted` | The dispatcher saves the proposed order | `engine`, `stops` |
| `route.proposal_dismissed` | The dispatcher closes the preview without saving | `engine`, `stops` |
| `route.proposal_undone` | The dispatcher undoes a saved auto route | `engine` |
| `route.manual_change_after_optimize` | A stop is moved by hand on a lane that was auto-routed that day | `engine` |
| `route.stop_out_of_order` | A technician completes a stop out of the published order | `published_position`, `actual_position`, `stops` |

Other threads add events by adding an entry to the catalog (name, allowed props, types). Inventory events from the resupply feature go here when that thread adds them.

## 5. Public website and each person's own choice

Visitors to routeverde.com who are not signed in to a business: only `error.client` reports with `surface = public`, no tenant, no cookies, no identifier, same scrubbing. No page views, no visitor tracking. So the public site needs no analytics consent; the cookie banner only covers whatever essential cookies the site sets (sign-in session).

Each person can also opt out for themselves, whatever their business chose: the browser reporter sends nothing when the cookie banner is set to "Essential only" or Global Privacy Control is on, and it stops mid-session when that changes. With no choice made, it sends nothing (opt-in): it reports only after the person accepts measurement in the banner (cookie `rv_consent` starting `v1.a1.`), and never under GPC. Server-side events follow the business setting only.

## 6. Retention and access

- Raw events are deleted after 180 days by a daily job.
- Only RouteVerde developers can read them, through the developer console (DEVELOPER_EMAILS + email code + second factor). Each view is written to the append-only operator audit.
- The console shows counts, rates and scrubbed error text. Business names appear only next to `identified` events.

## 7. Not product analytics (stated so the policy is complete)

These exist at every level, including `none`, because they are how the service runs, not analytics:
- Operational records the product itself needs (failed payments, failed messages, sync conflicts, import/export status). The developer console shows counts and system error text from these.
- Hosting request logs (Netlify) and the app's server log lines, which carry no customer data by design.

## 8. Changelog
- 2026-10-09 v1. Adopted from the project contract (`privacy/data-collection-contract.md`).
- 2026-10-09 v1.2: opt-in at both levels; business default `none` until answered at onboarding; browser reporter needs the person's banner opt-in.
- 2026-10-09 v1.1: per-person opt-out (banner Essential only, GPC) gates the browser reporter.
