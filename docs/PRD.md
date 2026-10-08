# RouteKeep PRD

Path in repo: `docs/PRD.md`
Status: v1.0, normative
Background and evidence: `docs/RESEARCH.md` (IDs such as `R-PAIN-01` refer to that file)
Last updated: 2026-10-07 (v1.2: white label offer, branded documents, public site; v1.1: technician sales and commission)

## 0. How to use this file (for Claude and other agents)

- This file is the source of truth for what to build. Follow it over any other document.
- Every requirement has a stable ID. Reference IDs in commits, PR titles, and test names (example: `FR-MIG-07: dry-run report`).
- Priority tags: `[MVP]`, `[P2]`, `[P3]`. Build only `[MVP]` items unless told otherwise.
- "MUST" is mandatory. "SHOULD" is expected unless there is a written reason in the PR.
- Section 4 (Decisions) and section 5 (Budget) are constraints. Do not add a paid service, a new vendor, or a new deployable without updating section 4 first and getting the owner's approval.
- Section 12 (ENG rules) applies to all code, always.
- If something is unspecified, choose the simplest option that satisfies the IDs, note the assumption in the PR, and continue. Stop and ask only for irreversible choices (schema deletes, vendor lock-in, anything that spends money).
- Pin dependency versions at the latest stable release when the repo is created. Do not invent version numbers from memory.
- Clean-room rule (binding): never copy FieldRoutes code, UI assets, copy, or screenshots. Never use a FieldRoutes login or API key. Import only from files the customer exports themselves.

## 1. Summary

RouteKeep is a multi-tenant SaaS for pest control and lawn care operators with 1 to 10 trucks. It covers customers, recurring service plans, scheduling, route optimization, an offline technician app, pesticide application records, billing with autopay, reminders, a customer portal, and self-serve migration in and out.

Positioning: published month-to-month pricing, no setup fee, works offline, your data leaves whenever you want.

First market: Utah and the Mountain West.

## 2. Goals and non-goals

### Goals
- G-01 Sign the first paying customer with total cash outlay under $100 (section 5).
- G-02 A new tenant can migrate from FieldRoutes, PestPac, GorillaDesk, Jobber, or a spreadsheet and run a first route within one day.
- G-03 A technician can complete a full day with no connectivity and lose nothing.
- G-04 Every application record meets Utah R68-7-11(11) by construction.
- G-05 Zero duplicate charges. Zero cross-tenant data exposure.

### Non-goals for MVP
Door-to-door sales app (canvassing, territories, door contracts; technician sales of a plan at a stop are in scope, see 8.5.1), marketplace, multi-branch roll-ups, general ledger, payroll, inventory, voice or IVR, custom report builder, self-serve white label (white label is a done-for-you service, see D-14), non-US tenants, native app store binaries, SOC 2 audit, AI features.

## 3. Personas

| ID | Persona | Primary jobs |
|---|---|---|
| P-OWN | Owner or admin | Setup, pricing, products, users, payments, reports, export |
| P-OFF | Office or CSR | Create customers, sell plans, book, reschedule, take payments, collections |
| P-DIS | Dispatcher (often same person as P-OFF) | Build and optimize routes, move stops, watch progress |
| P-TEC | Technician | Run the route, record service and products, photos, signature, payment |
| P-CUS | End customer | Reminders, pay, update card, view history and records |

## 4. Decisions

| ID | Decision | Reason | Revisit when |
|---|---|---|---|
| D-01 | One Next.js (App Router, TypeScript strict) app serves office UI, technician PWA, customer portal, and API routes | One deployable for a solo builder | Never for MVP |
| D-02 | Supabase: Postgres, PostGIS, RLS, Auth, Storage | Portable Postgres, already connected | Never for MVP |
| D-03 | Host on Netlify Free. Code MUST stay host-portable (no Netlify-only APIs outside `/infra/netlify`) | Free tier permits commercial use; Vercel Hobby does not | Credits exhausted, or any request needs more than 60 s synchronous: move to Netlify Personal ($9) or Vercel Pro ($20) |
| D-04 | No request handler may run longer than 20 s. All long work runs as durable steps (Inngest free tier) or Netlify background functions | Host limit is 60 s; keep margin | Never |
| D-05 | Technician app is an installable offline PWA inside the same app. No native binaries in MVP | Saves store fees and a second codebase | First revenue: wrap with Capacitor for App Store and Play |
| D-06 | Offline sync via PowerSync web SDK on the Cloud Free plan, behind a `SyncProvider` interface | Avoid building sync | 50 concurrent connections or free-plan limits reached: PowerSync Pro ($49) or self-host the open edition |
| D-07 | Route optimization is our own, no outside optimizer (owner decision 2026-10-07, replacing the Google and VROOM adapters). Two layers: (1) the built-in solver (`lib/domain/routing.ts`): windows first, then driving, instant, no third party; (2) the AI route planner (`lib/routing/ai-planner.ts`): the most capable Claude model (default `claude-fable-5-1`, set by `ROUTE_AI_MODEL`) plans with tools that measure on our own map model, starting from the solver's order. It reads access and visit notes the solver cannot. Every order it submits is measured by our code and refused if it is later than the solver's or more than 10% longer; after two refusals the solver's order stands. Runs in short steps (D-04). The dispatcher always previews and decides | Owner wants routing that is ours and better than generic optimizers; the model brings judgment on notes, our code keeps it honest on numbers | Road distances: the map model is straight-line times a road factor until a self-hosted road graph (OSRM on open map data) is added behind the same `measure` seam. Cost: revisit if AI plan spend per tenant passes 10% of their plan price |
| D-08 | Maps: MapLibre GL with open tiles. Geocoding: Google Geocoding (free monthly allowance), results cached per property | Avoid per-load map fees | Geocoding volume near 10,000/month |
| D-09 | Payments: Stripe Connect, Standard-style connected accounts, direct charges, Stripe-hosted card and bank fields. Stripe sets processing price; tenant pays it | No platform fees, lowest liability and PCI scope | Need to earn a payment margin |
| D-10 | Messaging: email (Resend free tier) from day 1. SMS (Twilio) only after the tenant's 10DLC brand and campaign are approved. Registration and usage costs pass through to the tenant | Compliance cannot be skipped; cost belongs to the tenant's brand | Never |
| D-11 | Pricing: Starter $79/month (up to 300 active customers), Pro $179 (up to 1,500), Growth $349 (up to 5,000). Unlimited users. Month to month. No setup fee | Keeps the per-customer-count model users like (R-PRICE-07) | After 5 customers |
| D-12 | Billing for RouteKeep's own subscription uses Stripe Billing on the platform account | Standard | Never |
| D-13 | Deferred spend: trademark filing, attorney review, SOC 2, QuickBooks sync, Apple and Google developer accounts | Not required to sign customer 1 | First revenue |
| D-14 | White label as a done-for-you service: $5,000 one time per business, then their regular monthly plan. Includes their logo, colors and name on the office app, technician app, portal and every document, with the product credit removed (FR-BRD-03; invoices are branded on every plan, FR-BRD-01); personalized setup (their services, plans, forms and reports shaped around how they work); setup support start to finish, including customer list import from their own export; advice on technician hardware (phones, tablets, accessories) and what is worth maintaining; their own domain once they own one; one year of support (defects and help, not new features). After the first year, support renews at $500 a year, optional. The goal is a product that needs little support. Owner decisions 2026-10-07 ($2,000 first, raised to $5,000 the same day) | Covers 20 to 40 hours of personalized setup and a support year with margin; the $500 renewal prices support at a level that rewards building it right | After 3 white label sales, or if setup regularly runs past 40 hours |

## 5. Budget constraint

Hard cap: $100 total cash from repo creation through the first customer's go-live month.

| Stage | Item | Cash |
|---|---|---|
| Build and demo | Domain | about $12 |
| Build and demo | Supabase Free, Netlify Free, Inngest, Sentry, Resend, PowerSync Free, Google free allowances, Stripe | $0 |
| Go-live month | Supabase Pro (required once real customer records exist, see CR-09) | $25 |
| Go-live month | Tenant 10DLC registration, pass-through, only if the tenant wants SMS | about $21, recovered |
| Buffer | Netlify Personal if credits run out, or overage | about $40 |

Rules:
- BUD-01 MUST NOT run a paid product on Vercel Hobby.
- BUD-02 MUST NOT store real customer data on Supabase Free. Upgrade to Pro before the first production import commit (FR-MIG-12).
- BUD-03 While on Supabase Free, a scheduled GitHub Action MUST ping the project daily so it does not pause.
- BUD-04 To conserve Netlify credits: deploy from `main` only, disable deploy previews, test locally with the Netlify CLI.
- BUD-05 Free-tier limits for Inngest, Sentry, and Resend are unverified. Check each at signup and record the limits in `docs/VENDORS.md`.

## 6. Architecture

```
Browser (office UI) ─┐
Technician PWA ──────┼─> Next.js on Netlify ──> Supabase Postgres (RLS)
Customer portal ─────┘        │                      ▲
                              ├─> Inngest (durable jobs: recurrence, billing, messaging, import)
Technician PWA <── PowerSync ─┴──────────────────────┘
External: Stripe (payments, webhooks), Resend (email), Twilio (SMS, after 10DLC),
          Google (geocoding, route optimization adapter)
```

### Repo layout
```
/app                 Next.js routes: (office), (tech), (portal), /api
/lib/domain          Pure business logic, no framework imports
/lib/providers       RouteOptimizer, SyncProvider, Geocoder, Messenger, Payments adapters
/lib/import          Migration engine (section 9)
/supabase/migrations SQL migrations, RLS policies
/supabase/tests      pgTAP tests (RLS, constraints)
/inngest             Job definitions
/infra/netlify       Host-specific config only
/tests/e2e           Playwright
/docs                PRD.md, RESEARCH.md, VENDORS.md, DESIGN_LOG.md
```

### Dependencies (pin at latest stable)
- Web: next, react, typescript, tailwindcss, shadcn/ui (Radix), @tanstack/react-query, @tanstack/react-table, zustand, react-hook-form, zod, date-fns, date-fns-tz, rrule, @dnd-kit/core, maplibre-gl, react-map-gl, @turf/turf
- Data: @supabase/supabase-js, @supabase/ssr, drizzle-orm (or kysely), PostGIS, pgTAP
- Offline: @powersync/web, service worker via serwist
- Jobs: inngest
- Payments: stripe, @stripe/stripe-js
- Messaging: resend, twilio
- Import: papaparse
- Documents: @react-pdf/renderer
- Observability: @sentry/nextjs
- Testing: vitest, @testing-library/react, playwright, fast-check
- CI: GitHub Actions, Supabase CLI, Netlify CLI

## 7. Data model

Every table has `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`. RLS policy on every table: `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`. Mutable scheduling tables also have `version int`.

| Table | Key columns |
|---|---|
| tenants | name, timezone (IANA), state, business_license_no, settings jsonb, plan |
| offices | address, business_license_no |
| memberships | user_id, role (owner, admin, office, dispatcher, technician) |
| technicians | user_id, applicator_license_no, license_expiry, categories |
| commissions | technician_id, customer_id, subscription_id, basis_cents, flat_cents, pct, amount_cents, status (FR-SAL-02) |
| customers | name, billing contact, sms_consent_at, sms_consent_source, email_opt_in, external_ref, sold_by_technician_id |
| properties | customer_id, address, location geography(Point), geocode_confidence, location_locked, access_notes, sq_ft, lawn_area_sq_ft, external_ref |
| service_types | name, category (pest, lawn, termite, mosquito) |
| service_plans | service_type_id, price, rrule, initial_price |
| subscriptions | customer_id, property_id, plan_id, start_date, status, autopay, external_ref |
| appointments | subscription_id null, property_id, technician_id, local_date, window_start, window_end, tz, status, sequence, client_key |
| routes | technician_id, local_date, optimized_at, optimizer, run_id |
| products | name, epa_reg_no, signal_word, restricted_use, default_unit |
| applications | appointment_id, product_id, mix_rate, mix_unit, total_amount, amount_unit, target_site, target_pest, area_treated, area_unit, applicator_id, applied_at, recorded_at, amended_from null |
| invoices | customer_id, subscription_id null, period_key, status, total |
| invoice_lines | invoice_id, description, amount |
| payments | invoice_id, stripe_payment_intent_id, client_payment_key, amount, method, status |
| ledger_entries | append-only: type (invoice, payment, credit, refund, opening_balance), amount, ref |
| messages | channel, template, to, status, provider_id |
| outbox_events | event_id, channel, payload, sent_at |
| webhook_events | provider, event_id, received_at |
| agreements | customer_id, pdf_path, sha256, signer_name, signer_ip, signed_at, consent_text_version |
| attachments | owner_type, owner_id, path, kind (photo, signature, document) |
| audit_log | actor_id, table_name, row_id, before jsonb, after jsonb |
| import_jobs, import_rows, import_mappings | section 9 |
| exports | requested_by, status, path |

Constraints (MUST exist as database constraints, not only app checks):
- DB-01 `unique (tenant_id, client_payment_key)` on payments.
- DB-02 `unique (tenant_id, subscription_id, period_key)` on invoices.
- DB-03 `unique (provider, event_id)` on webhook_events.
- DB-04 `unique (event_id, channel)` on outbox_events.
- DB-05 `unique (tenant_id, client_key)` on appointments and applications (offline idempotency).
- DB-06 `unique (tenant_id, source, external_ref)` on imported entities.
- DB-07 ledger_entries: no UPDATE or DELETE grants.
- DB-08 applications: UPDATE blocked 24 h after `recorded_at`; changes create a new row with `amended_from`.

## 8. Functional requirements

### 8.1 Tenant setup `[MVP]`
- FR-SET-01 Owner signs up, creates tenant with timezone, state, business name, and license number.
- FR-SET-02 Invite users with roles. Technicians require applicator license number and expiry.
- FR-SET-03 Product catalog with EPA registration number, signal word, restricted-use flag. Seed common products; allow custom.
- FR-SET-04 Service types and plans with price and recurrence.
- FR-SET-05 Connect Stripe (onboarding link). Until connected, billing features show a setup prompt.
- Accept: a new tenant reaches a usable empty schedule in under 10 minutes.

### 8.2 Customers and properties `[MVP]`
- FR-CRM-01 Create, edit, search customers; multiple properties per customer.
- FR-CRM-02 On address entry, geocode and show the pin with confidence. Below threshold, require confirmation. Pin is draggable and lockable (R-BUG-05).
- FR-CRM-03 Timeline per customer: appointments, applications, invoices, payments, messages.
- FR-CRM-04 Record SMS consent with timestamp and source; email opt-in.

### 8.3 Plans, subscriptions, appointments `[MVP]`
- FR-SUB-01 Sell a subscription: initial service plus recurring frequency (RRULE).
- FR-SUB-02 A daily job generates appointments 60 days ahead, idempotently.
- FR-SUB-03 Edit one occurrence or all future ones. Skip, pause, cancel with reason.
- FR-SUB-04 One-off appointments without a subscription.
- Accept: recurrences are correct across both DST changes in the tenant timezone (test required).

### 8.4 Schedule and dispatch `[MVP]`
- FR-DSP-01 Split view: technician timeline lanes and a map, shared selection.
- FR-DSP-02 Drag a stop to another time, day, or technician. Optimistic concurrency with a conflict message.
- FR-DSP-03 "Optimize" per technician per day: shows a preview diff (order, drive time), then commit or discard. Undo last commit.
- FR-DSP-04 Always-visible queue of unscheduled, skipped, and cancelled work (R-PAIN-08).
- FR-DSP-05 The same stop sequence number appears on map, list, and technician app (R-BUG-06).
- FR-DSP-06 Flag any stop whose travel leg is more than 3x the route median before publishing.
- Accept: 500 stops render in under 1.5 s on a mid-range laptop.

### 8.5 Technician PWA `[MVP]`
- FR-TEC-01 Installable PWA. Today's and tomorrow's routes, customers, properties, products, and notes sync at shift start and incrementally.
- FR-TEC-02 All screens read from local storage. No screen blocks on the network.
- FR-TEC-03 Stop flow: Arrive, checklist, Products, Photos, Signature, Payment, Complete.
- FR-TEC-04 Every field edit persists locally within 500 ms. Killing or backgrounding the app at any step loses nothing (R-BUG-01).
- FR-TEC-05 Persistent sync chip: "All saved on device" plus count waiting to upload.
- FR-TEC-06 Product entry: favorites, last-used mix for the property, unit-typed inputs with live conversion preview (R-BUG-07).
- FR-TEC-07 A stop cannot be completed if a required record field (CR-01) is missing. Show exactly which field.
- FR-TEC-08 Payment in the field: online only via Stripe-hosted fields, or "charge card on file" or "invoice later" queued with a `client_payment_key`. Never capture card numbers offline.
- FR-TEC-09 Photos and signatures store locally, upload in the background, and survive app restarts.
- FR-TEC-10 One-tap navigate to the stop in the device's maps app.
- FR-TEC-11 Outdoor high-contrast mode; primary actions bottom-anchored; touch targets at least 48 px.
- Accept: Playwright test completes a 15-stop route fully offline, kills the tab mid-form twice, reconnects, and the server shows 15 complete stops with all records and no duplicates.

### 8.5.1 Technician sales and commission `[MVP]`
Added 2026-10-07 by owner decision: technicians often sell plans in the field and are paid a commission on them.
- FR-SAL-01 Owner setting, off by default: technicians may add customers. Commission rule per tenant: a flat amount per sale plus a percent of the plan's first service price; either may be zero.
- FR-SAL-02 A technician adds a customer, property and optional plan from the technician app (needs a connection). The customer records the selling technician; technicians can credit only themselves. The office may credit a technician when entering a sale for them. One commission per customer, computed by the database from the rule at the time of sale; nobody can set the amount by hand.
- FR-SAL-03 Commission status: waiting for approval, approved, paid, void. The office approves, marks paid (payroll happens outside the product) or voids with a reason. Paid is final. Amounts never change after the sale. Every change is audited.
- FR-SAL-04 Technicians see their own sales and commission status. The office sees commissions by date, technician and status, with CSV.
- Accept: a technician with sales on adds a customer with a plan and sees the commission the rule gives; with sales off they cannot; the office approves and pays it; the amount cannot be edited.

### 8.6 Application records `[MVP]`
- FR-REC-01 Each completed service produces an application record per product with all CR-01 fields.
- FR-REC-02 PDF service record for the customer with business name and license number.
- FR-REC-03 Records are immutable after 24 h; amendments are new rows linked to the original, with an audit entry.
- FR-REC-04 Record state template is per tenant state. Utah template ships first.
- FR-REC-05 Restricted-use products with Danger signal words prompt for the pre-application customer statement.
- FR-REC-06 Report: product usage by date range, product, EPA number, technician; exportable CSV and PDF.

### 8.7 Billing and payments `[MVP]`
- FR-BIL-01 Invoices generated on service completion or on a billing schedule, one per subscription period.
- FR-BIL-02 Autopay by card or ACH using Stripe-hosted setup and stored mandates.
- FR-BIL-03 Billing runs as one durable step per invoice; a failed item never blocks others; reruns are safe.
- FR-BIL-04 Failed payments enter a retry schedule and a collections list.
- FR-BIL-05 Receipts and invoices by email; SMS when enabled.
- FR-BIL-06 Refunds and credits create ledger entries; nothing edits history.
- FR-BIL-07 Nightly reconciliation of ledger against Stripe; mismatches listed for the owner.
- FR-BIL-08 Reports: revenue, AR aging, production by technician.

Billing rules as built in M4 stage 1 (2026-10-07; change only with the owner):
- A finished visit with a price is billable once. Plans billed per service, and one-off visits, get one invoice per visit. Plans billed monthly, quarterly or yearly get one invoice per closed calendar period (in the business's time zone) listing each finished visit at its own price; a visit finished after its period was invoiced gets a supplementary invoice for that period.
- Invoices are due on issue until payment terms exist as a setting. Aging counts days past the due date: not due, 1 to 30, 31 to 60, 61 to 90, over 90.
- Payments taken in the field post against their visit's invoice on the next run; one whose visit is not invoiced yet (a plan billed by period, mid-period) posts as credit on the customer's account and lowers what they owe, but is not tied to the later invoice.
- An invoice is paid when its ledger balance reaches zero. Recording more than an invoice still owes is refused. Void needs a reason and posts an offsetting credit; void and uncollectible invoices never reopen.
- The run is started by the office ("Invoice finished visits") or the nightly job (`npm run billing:run`); each invoice and each payment is its own transaction, failures are listed on the run, and a rerun only does what is left.
- Stage 2 (built 2026-10-09, tested end to end against a local stand-in for Stripe's API; not yet run against a real Stripe account): the owner connects the business's own Stripe account (Standard, D-09) in Settings, Payments. Customers pay an invoice from the portal on Stripe's Checkout page, and set up autopay with a card or bank account on Stripe's page, which shows the words they agree to; those words are stored with the method (CR-06), and the portal and the office can turn autopay off at once. Autopay charges an invoice when it is issued, then retries 3 and 7 days later; each failure emails the customer and leaves the invoice in collections. Owners and admins refund from the invoice; the refund and, by default, a matching credit are ledger entries. Webhooks are verified and deduplicated (ENG-03); every Stripe call that moves money carries a key derived from our row (ENG-02). A nightly check applies anything a lost webhook missed and lists what it cannot square (FR-BIL-07).

### 8.8 Messaging `[MVP]`
- FR-MSG-01 Email reminders, "on the way", service complete, invoice, payment failed.
- FR-MSG-02 SMS for the same events only when the tenant's 10DLC status is approved and the recipient has consent on file.
- FR-MSG-03 Onboarding step collects the tenant's 10DLC brand details and shows registration status.
- FR-MSG-04 STOP, HELP, quiet hours by recipient timezone, unsubscribe link on email.
- FR-MSG-05 Usage ledger: every billed message links to a message row the tenant can see (R-BUG-10).

### 8.9 Customer portal `[MVP]`
- FR-POR-01 Passwordless sign-in by email link (SMS code when enabled).
- FR-POR-02 Next visit, history, downloadable service records, pay invoice, update card or bank, request service.

### 8.10 Export `[MVP]`
- FR-EXP-01 Owner can export the entire tenant at any time: every table as CSV and JSON, attachments as a ZIP, application records as PDFs.
- FR-EXP-02 Export completes in under 10 minutes for 10,000 customers and is delivered by expiring link.
- FR-EXP-03 Export format is documented and is itself a valid import source (FR-MIG-02).

### 8.10.1 Branded documents `[MVP]`
Added 2026-10-07 by owner decision; scope corrected the same day.
- FR-BRD-01 On every paid plan (all plans are paid), invoices show the business's logo, name, address and license and carry no product branding at all, including in file metadata.
- FR-BRD-02 Logo upload: PNG or JPEG up to 1 MB (PDFs cannot embed SVG), stored in the private bucket, shown on screen to members and embedded in invoices; a preview before saving.
- FR-BRD-03 Everything else a customer sees (service records, statements, the customer portal, emails and texts) carries the business's name and license (CR-03) and a small "Powered by" product credit, unless the business bought white label (D-14). White label removes the credit everywhere and puts the business's logo and colors on the office app, technician app, portal and every document. Only the platform can switch white label on (`tenants.white_label_at`, service role).
- Accept: an invoice for any paid business shows its logo and contains no occurrence of the product name; a service record PDF shows the credit without white label and none with it.

### 8.10.2 Public site `[MVP]`
Added 2026-10-07 by owner decision.
- FR-WEB-01 A public landing page at `/`: what the product does, posted pricing (D-11), the white label offer (D-14), and a FAQ. Indexable, with structured data (SoftwareApplication, FAQPage), a sitemap, robots rules that keep the app private, a social card and `/llms.txt` for AI assistants. Every claim matches what is built; nothing invented (no reviews, no customer logos until real).
- FR-WEB-03 Public Terms, Privacy Policy, Data Processing Addendum, subprocessor list (CR-13) and a status page (NFR-04), linked from the landing page footer. Added 2026-10-08.
- FR-WEB-02 Signed-in work starts at `/app`. `app.` and `login.` subdomains of the owner's domain open the app directly; `/login` does the same on any host.

### 8.11 Later phases
- `[P2]` QuickBooks Online sync; dunning workflows; bait station barcodes and inspections; termite diagrams; lawn depth (area-based rates, multi-round programs, weather); online booking widget; review requests; multi-state record templates; public API and webhooks; AI intake and note drafting; Capacitor native wrapper; VROOM adapter in production.
- `[P3]` Door-to-door sales app with agreements and cooling-off notice; commissions; multi-branch; marketing campaigns; fleet GPS; SOC 2.

## 9. Migration tools `[MVP]`

Goal: an owner with no technical help moves a full book of business in one sitting and trusts the result. This is a headline feature, not a utility.

### 9.1 Sources
- FR-MIG-01 Guided presets for FieldRoutes, PestPac, GorillaDesk, Jobber, and QuickBooks customer lists. Each preset is a saved column mapping plus value transforms, stored as data in `import_mappings`, not code.
- FR-MIG-02 Generic CSV and XLSX for spreadsheets, and RouteKeep's own export format.
- FR-MIG-03 Presets are built only from files real customers export. The first preset for each source is created during a concierge migration and saved for reuse. No competitor credentials or APIs are used.

### 9.2 What can be imported
- FR-MIG-04 Entities, in dependency order: customers, properties, service plans, subscriptions with recurrence and next service date, future appointments, technicians, products, historical service and application records, open invoices and balances, notes, documents.
- FR-MIG-05 Historical application records import as read-only history flagged `imported`, so the tenant keeps its retention obligation in one place.
- FR-MIG-06 Open balances import as `opening_balance` ledger entries. Paid history is optional summary only.
- FR-MIG-07 Payment methods are never imported from files. The wizard generates a processor-to-processor token transfer request the owner sends to the old vendor and to Stripe, tracks its status, and re-links tokens to customers by `external_ref` when Stripe confirms. Until then, autopay customers are listed as "needs payment method" with a one-click email asking them to re-enter it in the portal.

### 9.3 Wizard flow
- FR-MIG-08 Step 1 Upload: accept multiple files, detect source preset, show row counts.
- FR-MIG-09 Step 2 Map: auto-map columns; unmapped required fields are highlighted; mapping can be saved as a new preset. Column matching uses header names and sample values (rule-based in MVP; AI suggestions are `[P2]`).
- FR-MIG-10 Step 3 Validate: every row lands in `import_rows` staging with status and reasons. Checks: required fields, duplicates within file and against existing data, address geocode with confidence, recurrence parse, phone and email format, unknown products or technicians.
- FR-MIG-11 Step 4 Dry run: a report showing what will be created, updated, and skipped, with totals for customers, active subscriptions, monthly recurring revenue, and open AR. Downloadable error file containing only failed rows with a reason column, ready to fix and re-upload.
- FR-MIG-12 Step 5 Commit: runs as durable steps, resumable, idempotent on `(tenant_id, source, external_ref)`. Re-running the same file creates no duplicates.
- FR-MIG-13 Step 6 Reconcile: side-by-side source totals versus imported totals. Any mismatch is listed by entity.
- FR-MIG-14 Rollback: any committed import can be fully reversed within 7 days if none of its records have been billed or serviced; otherwise partial rollback of untouched records with a report.

### 9.4 Cutover support
- FR-MIG-15 Parallel-run mode: imported appointments can be marked "shadow" so the tenant can compare routes with the old system for up to 14 days without sending customer messages or charges.
- FR-MIG-16 Delta import: re-upload a fresh export later; only new and changed rows apply.
- FR-MIG-17 Cutover checklist screen: Stripe connected, 10DLC status, tokens transferred, technicians invited, first route optimized, customer notice email sent.
- FR-MIG-18 Customer notice: optional templated email announcing the new portal link.
- FR-MIG-19 Messaging is suppressed for imported records until the owner clicks "Go live".

### 9.5 Acceptance
- A 3,000-customer FieldRoutes-style export (fixture in `/tests/fixtures/import`) goes from upload to reconciled commit in under 15 minutes, with at least 98% of valid rows imported without manual mapping after the preset exists.
- Importing the same file twice changes nothing.
- A file exported by FR-EXP-01 re-imports into an empty tenant with identical totals.
- Rollback leaves the tenant byte-identical to its pre-import state for untouched records (test compares table checksums).

## 10. Compliance requirements

These are the floor. None may be traded for cost.

| ID | Requirement | Cost |
|---|---|---|
| CR-01 | Application record MUST contain: customer name and address, application address, area treated, target sites, date and time, product brand name, EPA registration number, mix rate, total amount applied, purpose and target pest, applicator name, business address, applicator license number | $0 |
| CR-02 | Record MUST be captured within 24 h of application; show status; warn at 20 h | $0 |
| CR-03 | Business name and license number on every service record and notice | $0 |
| CR-04 | Records retained at least 2 years from the application date and included in exports. Utah Admin. Code R68-7 (commercial applicator records): "Records shall be kept for a period of at least two years from the date of the pesticide application", made within 24 hours, "available for inspection by the department upon request" and "furnished in a uniform format". Seen in search excerpts of the rule (2021 to 2024 versions), not yet read from the current official text: owner to confirm with UDAF (OQ-03) | $0 |
| CR-05 | Card and bank details only through Stripe-hosted fields. No card data in our database, logs, or offline storage | $0 |
| CR-06 | ACH autopay requires a stored Stripe mandate and a visible way to revoke | $0 |
| CR-07 | No SMS without (a) approved tenant 10DLC registration and (b) recorded recipient consent. STOP and HELP honored | about $21 per tenant, pass-through |
| CR-08 | Marketing email carries unsubscribe and physical address | $0 |
| CR-09 | Production data MUST have automated daily backups and a tested restore before the first real record is stored | $25/month (Supabase Pro) |
| CR-10 | RLS on 100% of tenant tables with an automated cross-tenant read and write test per table | $0 |
| CR-11 | E-signed documents store signer identity, timestamp, IP, consent text version, and document hash | $0 |
| CR-12 | Audit log on financial and compliance tables | $0 |
| CR-13 | Publish Terms, Privacy Policy, a DPA, and a subprocessor list before the first customer. Templates are acceptable for customer 1; attorney review is deferred risk (D-13) | $0 now |
| CR-14 | No card surcharge feature in MVP. Offer ACH as the low-fee option instead | $0 |
| CR-15 | MFA available for owner and admin roles | $0 |
| CR-16 | Restricted use pesticides: the customer gets a copy of the application record within 30 days (7 U.S.C. 136i-1(a)(2)). The service record PDF covers it; M6 emails it automatically for RUP applications | $0 |

## 11. Non-functional requirements

- NFR-01 Offline: full route day with zero connectivity; zero data loss on app kill.
- NFR-02 Sync conflicts: server wins on schedule fields; client wins on field-captured records; conflicts go to a review queue.
- NFR-03 Performance: office interactions p95 under 300 ms; technician route opens under 1 s from local data; optimize one technician with 60 stops under 15 s.
- NFR-04 Reliability: billing and messaging jobs idempotent and resumable; public status page.
- NFR-05 Accessibility: WCAG 2.2 AA on office and portal; color-blind-safe route colors.
- NFR-06 Observability: Sentry on web and PWA; structured logs with tenant and request ids; job failure dashboard.
- NFR-07 Portability: provider interfaces for hosting-specific code, routing, sync, geocoding, messaging, payments.
- NFR-08 Privacy: only addresses and coordinates go to Google; no customer names, phones, or notes. The AI route planner (D-07) receives stop aliases, service types, windows, durations, positions in kilometres from the office (no coordinates) and access and visit notes with numbers, phone numbers and emails removed; never names or addresses (tested end to end). Subprocessors listed in `docs/VENDORS.md`.

## 12. Engineering rules (always apply)

- ENG-01 Idempotency: every write that can be retried carries a client-generated key enforced by a unique constraint (DB-01 to DB-06).
- ENG-02 Stripe calls that move money pass an idempotency key derived from the row id.
- ENG-03 Inbound webhooks verify signatures and dedupe on provider event id before any side effect.
- ENG-04 Outbound messages go through the outbox; send only after the triggering transaction commits.
- ENG-05 Time: store local date, local time, and IANA zone for anything a human schedules. Store instants as `timestamptz`. Never store a UTC offset.
- ENG-06 Money: integer cents. Ledger is append-only. Reports read from ledger views.
- ENG-07 Concurrency: mutable scheduling rows use a `version` check on update.
- ENG-08 Tenant isolation: no query without RLS; service-role key never reaches the browser; pgTAP cross-tenant test required for each new table.
- ENG-09 Forms in the technician PWA persist to local storage on change, not on submit.
- ENG-10 Feature flags for anything user-visible that is not finished. In-app changelog entry for every release.
- ENG-11 Tests required before merge: unit tests for domain logic; Playwright for the critical flows (sell subscription, optimize route, complete stop offline, bill and pay, import, export); DST recurrence tests; unit conversion property tests.
- ENG-12 No handler over 20 s (D-04). No new paid service (section 0).
- ENG-13 Keep `docs/DESIGN_LOG.md` updated with dated notes on how each feature was derived (clean-room record).

## 13. UX requirements

- UX-01 Office navigation has at most five top-level areas: Schedule, Customers, Billing, Reports, Settings.
- UX-02 The three most common office tasks (new customer with plan, reschedule, take payment) take at most 3 screens each.
- UX-03 Destructive or bulk actions show a preview and support undo where feasible.
- UX-04 Empty states teach the next step and link to import.
- UX-05 Technician UI is usable one-handed and in direct sunlight.
- UX-06 Original visual identity. Do not imitate any competitor's layout, colors, or iconography.

## 14. Build order

| Milestone | Scope | Exit test |
|---|---|---|
| M0 Foundation | Repo, CI, Supabase schema and RLS, auth, roles, tenant setup (8.1), Sentry | pgTAP cross-tenant tests pass |
| M1 Core records | Customers, properties, geocoding, plans, subscriptions, appointment generation (8.2, 8.3) | DST recurrence tests pass |
| M2 Dispatch | Schedule board, map, optimizer adapter 1 (8.4) | 500-stop render and optimize preview |
| M3 Technician PWA | Offline sync, stop flow, records, PDFs (8.5, 8.6) | 15-stop offline Playwright test |
| M4 Money | Stripe Connect, invoices, autopay, ledger, reconciliation (8.7) | Double-submit and webhook replay create no duplicates |
| M5 Migration and export | Section 9 and 8.10 | Section 9.5 acceptance |
| M6 Messaging and portal | 8.8, 8.9 | Consent and 10DLC gating tests |
| M7 Pilot hardening | Legal pages (CR-13), status page, backup restore drill (CR-09), demo tenant with seed data | Go-live checklist complete |

M5 is placed before messaging and the portal on purpose: a pilot customer cannot start without migration, and can start with email-only messaging.

Status 2026-10-08 (details in `replica/features.csv` and `replica/build-log.md`):

| Milestone | State | What is left |
|---|---|---|
| M0 to M3 | Done | CI on GitHub Actions (account permission), real-iPhone offline test (RISK-01) |
| M4 Money | Stage 1 done: invoices, cash and check, credits, voids, collections, money reports, invoice email. Stage 2 built and tested against a Stripe stand-in: Connect onboarding, portal pay, autopay with retries, webhooks, refunds, reconciliation | The owner's Stripe platform account and keys, then one live test payment and refund before customers use it |
| M5 Migration and export | Done for customer lists and full export | XLSX, named-vendor presets (from a real customer's file), technicians/products/history import, 10,000-customer export timing |
| M6 Messaging and portal | Email and portal done | SMS needs a provider account and 10DLC approval; online payment in the portal needs Stripe |
| M7 Pilot hardening | Legal templates, status page, restore drill script, white label theming, switch-over checklist done | Attorney review (D-13), legal entity (OQ-02), Supabase Pro and a production restore drill (CR-09) |

## 15. Success metrics

Time from import to first optimized route under 1 day. Zero duplicate charges. Billing job success at least 99.95%. No data-loss reports from technicians in pilot. First paying Utah customer within 60 days of M7. Total cash at go-live under $100.

## 16. Risks

| ID | Risk | Mitigation |
|---|---|---|
| RISK-01 | iOS may evict PWA storage or limit background upload, undermining the offline promise | Require install to home screen; upload on every foreground; show waiting count; test on real iPhones in M3; Capacitor wrapper is the first post-revenue spend |
| RISK-02 | Netlify free credits run out mid-pilot and the site pauses | BUD-04; usage alert; $9 Personal plan held in buffer |
| RISK-03 | Free-tier vendors deactivate idle projects (Supabase, PowerSync) | BUD-03 keepalive; upgrade triggers in section 4 |
| RISK-04 | Routing quality below the incumbent | Compare on pilot data; preview-and-undo keeps humans in control; adapter 2 available |
| RISK-05 | Addresses sent to Google conflict with privacy positioning | NFR-08 minimization; disclose in subprocessor list; VROOM adapter for tenants who require it |
| RISK-06 | Unknown export file layouts break presets | FR-MIG-03 concierge first migration; presets are data, fixable without deploys |
| RISK-07 | Template legal documents and unfiled trademark | CR-13, D-13; first revenue funds review; name check before public launch |
| RISK-08 | Scope creep by a solo builder | Section 2 non-goals; ENG-12; one deployable |
| RISK-09 | Payment token transfer delays leave autopay customers unbilled | FR-MIG-07 portal re-entry path and tracking |

## 17. Open questions (owner to answer)

- OQ-01 Answered 2026-10-07: new Netlify account, so the 300-credit plan (BUD-04 applies).
- OQ-02 Open. Recommendation (not legal advice): one legal entity owns RouteKeep, signs customer and white label contracts, and owns the Stripe platform account. Cheapest path that keeps liability separate: a Utah LLC for RouteKeep (or, if Echo Mind Automation is already an LLC, RouteKeep as its registered DBA until revenue justifies its own LLC), an EIN in the entity's name, a business bank account, and the Stripe platform account opened by that entity. Confirm current Utah filing fees and have an attorney review the white label agreement before the first $5,000 sale (D-13).
- OQ-03 Partly answered by research 2026-10-07 (CR-04, CR-16). Owner to confirm with UDAF Pesticide Program (UDAF-Pesticide@utah.gov, 801-538-7100): current R68-7 citation and retention, the complete field list and any template for the "uniform format", whether software-only records satisfy inspection, how fast records must be produced, and whether non-RUP applications require a customer copy or posting.
- OQ-04 Answered 2026-10-07: the name is RouteKeep. A USPTO search and domain check are still to be done by the owner before public launch (RISK-07).
- OQ-05 Answered 2026-10-07: no pilot yet. Target: a small pest control owner leaving the ServiceTitan family (FieldRoutes). The first preset is built from that customer's own FieldRoutes export during a concierge migration (FR-MIG-03); until then the generic CSV path is the import.

## 18. Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POWERSYNC_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GOOGLE_MAPS_API_KEY`, `ROUTE_OPTIMIZER` (`estimate`), `ANTHROPIC_API_KEY`, `ROUTE_AI_MODEL` (default `claude-fable-5-1`), `ROUTE_AI_EFFORT` (default `high`), `ROUTE_AI_STEP_MS`, `SENTRY_DSN`, `NEXT_PUBLIC_SALES_EMAIL` (default RouteKeep@proton.me).

Secrets live in Netlify and GitHub Actions secrets only. Never commit them.
