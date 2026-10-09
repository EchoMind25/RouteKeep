# Recon map: field service for pest and lawn operators (web + installable PWA)

Scope: the PRD `[MVP]` slice. Customers and properties, recurring plans, scheduling and dispatch, route optimization, offline technician app, pesticide application records, billing with autopay, reminders, customer portal, migration in and out.
For: RouteVerde (working name, see `docs/PRD.md` OQ-04), sold to pest and lawn operators with 1 to 10 trucks, Utah first.
Date: 2026-10-06

## Clean-room statement

This map is derived only from `docs/RESEARCH.md`, which itself cites public listings, public reviews, vendor press, and regulation text. No FieldRoutes screenshots were reviewed (R-UX-02), no account was used, no help text or marketing copy was copied. Screens and flows below are our own design for the jobs the PRD names, not a reconstruction of anyone's UI. `replica/screens/` is intentionally empty.

## Sources

| # | source | where | notes |
| --- | --- | --- | --- |
| 1 | Research brief | `docs/RESEARCH.md` | Feature inventory R-FEAT-01..17, pains R-PAIN-01..13, bug classes R-BUG-01..16 |
| 2 | Product requirements | `docs/PRD.md` | Normative. Every screen below maps to FR IDs |
| 3 | Utah Admin. Code R68-7-11(11), R68-7-16 | cited in RESEARCH 7.1 | Application record fields (CR-01) |
| 4 | Customer export files | none yet | First preset is built during the pilot's concierge migration (FR-MIG-03) |

## Core loop

An operator sells a recurring plan, the schedule fills itself, the technician runs the route without signal, the record is compliant by construction, and the customer is billed automatically.

## Screens

Routes are App Router paths. `(office)` is the CSR, dispatcher and owner surface; `(tech)` is the installable PWA; `(portal)` is the end-customer surface.

| ID | screen | route | purpose | key components | states to build |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign in | `/sign-in` | Office and technician sign in | Field, Button, Alert | empty, error, loading |
| S02 | Create business | `/onboarding` | FR-SET-01 tenant creation | Field, Select (timezone, state), Button | empty, validation error, saving |
| S03 | Setup checklist | `/setup` | FR-SET-01..05, FR-MIG-17 cutover steps | Checklist rows, Badge | fresh tenant, partial, done |
| S04 | Schedule board | `/schedule` | FR-DSP-01..06 lanes, map, unscheduled queue | Lane, StopCard, Map, Queue, DatePager | empty day, filled, conflict, 500 stops |
| S05 | Optimize preview | `/schedule` dialog | FR-DSP-03 diff, commit, discard, undo | Dialog, DiffList, Stat | running, preview, error, committed |
| S06 | Customers | `/customers` | FR-CRM-01 list and search | SearchField, Table, Pagination | empty (teach import), results, no match, loading |
| S07 | Customer detail | `/customers/[id]` | FR-CRM-03 timeline, properties, plans | Tabs, Timeline, PropertyCard | new customer, long history, error |
| S08 | New customer with plan | `/customers/new` | FR-CRM-01, FR-SUB-01, UX-02 (3 screens max) | Form, AddressField, PlanPicker | empty, validation, geocode low confidence |
| S09 | Property pin | dialog from S07/S08 | FR-CRM-02 confirm, drag, lock pin | Map, Pin, ConfidenceBadge | high, low confidence, locked |
| S10 | Appointment | `/schedule/appointments/[id]` | FR-SUB-03 edit one or all future, skip, cancel | Form, ScopeChoice, ReasonSelect | scheduled, completed (read-only), conflict |
| S11 | Billing | `/billing` | FR-BIL-01..07 invoices, collections, reconciliation | Table, Tabs, Badge | Stripe not connected, empty, failures |
| S12 | Take payment | dialog from S07/S11 | FR-BIL-02, CR-05 Stripe-hosted fields only | Dialog, Stripe Element slot | idle, processing, declined, succeeded |
| S13 | Reports | `/reports` | FR-BIL-08, FR-REC-06 | DateRange, Table, Export | empty range, filled |
| S14 | Settings | `/settings/*` | FR-SET-02..05, FR-MSG-03, CR-15 | Section nav, Forms | per section |
| S15 | Import wizard | `/settings/import` | FR-MIG-08..14 six steps | Stepper, FileDrop, MappingTable, Report | each step, errors file, rollback |
| S16 | Export | `/settings/export` | FR-EXP-01..03 | Button, JobStatus | idle, running, ready link, expired |
| S17 | Today's route (tech) | `/tech` | FR-TEC-01, 02, 05, 10 | SyncChip, StopRow, NavigateButton | offline, empty day, done |
| S18 | Stop flow (tech) | `/tech/stops/[id]` | FR-TEC-03..09, FR-REC-05 | Stepper, ProductEntry, PhotoCapture, SignaturePad | each step, missing field, restored after kill |
| S19 | Portal sign in | `/portal/sign-in` | FR-POR-01 | Field, Button | sent, expired link |
| S20 | Portal home | `/portal` | FR-POR-02 | NextVisit, History, Invoices | no visits, balance due |
| S21 | Design primitives | `/design` | replica-design check, not shipped in nav | Every primitive, every state | n/a |

## Flows

```
F01 Owner opens an account and reaches an empty schedule      (FR-SET-01, accept < 10 min)
    S01 sign up -> S02 create business -> S03 checklist -> S04 empty schedule
    happy path clicks: 6
    edge: invalid timezone, duplicate submit, user already owns a tenant

F02 CSR adds a customer with a recurring plan                  (FR-CRM-01, FR-SUB-01, UX-02)
    S06 -> S08 (customer + property + plan on one screen) -> S07 confirmation with first visits
    happy path screens: 3
    edge: low-confidence geocode (S09 confirm), plan with initial service, DST week start

F03 Dispatcher moves a stop                                    (FR-DSP-02)
    S04 drag stop to another lane/day -> saved, or conflict message if someone else changed it
    edge: version conflict, technician off that day, stop already completed

F04 Dispatcher optimizes one technician's day                  (FR-DSP-03, 05, 06)
    S04 -> S05 preview diff -> commit -> undo available
    edge: optimizer timeout, leg 3x median flagged, stop locked to a time window

F05 Technician completes a route with no signal                (FR-TEC-*, FR-REC-*, NFR-01)
    S17 -> S18 arrive -> checklist -> products -> photos -> signature -> payment -> complete
    edge: app killed mid-form, missing CR-01 field, restricted-use product, duplicate upload

F06 Nightly billing and autopay                                (FR-BIL-01..04)
    job -> one durable step per invoice -> charge with idempotency key -> receipt or collections

F07 CSR takes a payment                                        (FR-BIL-02, CR-05)
    S07 -> S12 -> receipt
    edge: double click, declined card, Stripe not connected

F08 Customer pays from the portal                              (FR-POR-*)
    S19 email link -> S20 -> pay

F09 Owner migrates from another system                         (FR-MIG-08..14)
    S15 upload -> map -> validate -> dry run -> commit -> reconcile
    edge: re-upload same file (no duplicates), rollback within 7 days

F10 Owner exports everything                                   (FR-EXP-*)
    S16 -> background job -> expiring link

F11 CSR skips, pauses or cancels a plan                        (FR-SUB-03)
    S07 -> S10 scope "this visit" or "this and future" -> reason
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, hover, active, focus-visible, disabled, loading | all |
| Field (label + input + help + error) | text, email, tel, number with unit, date, time, textarea | default, focus, invalid, disabled | S02, S08, S10, S14, S18 |
| Select | native, searchable | default, open, invalid | S02, S08, S14 |
| Badge | neutral, accent, success, warning, danger | static | S03, S07, S11, S17 |
| Dialog | default, destructive | open, submitting | S05, S09, S12 |
| Table | dense office table | loading skeleton, empty, filled, sorted | S06, S11, S13 |
| Tabs | underline | default, selected, focus | S07, S11 |
| SyncChip | saved, waiting n, offline, error | live | S17, S18 |
| Stepper | tech stop flow, import wizard | current, done, blocked | S15, S18 |
| EmptyState | with action, with import link (UX-04) | static | S04, S06, S11, S13 |

## Inferred data model

Taken from PRD section 7 (normative). Evidence for field existence in the original: R-FEAT-01..16. Compliance fields: R-COMP-02. Confidence: high for every entity, because the PRD defines them; the original's internal model is not used.

Relationships: Tenant 1-n Office, Membership, Technician, Customer. Customer 1-n Property. Property 1-n Subscription. ServicePlan 1-n Subscription. Subscription 1-n Appointment. Appointment 1-n Application. Customer 1-n Invoice 1-n InvoiceLine. Invoice 1-n Payment. Customer 1-n LedgerEntry.

## Feature matrix

See `features.csv`. Built from PRD FR IDs, not from the original's menu. Must: 88 (73 FR + 15 CR), should: 8 (NFR), skip: 3. Count with `python3 parity.py replica/features.csv`.

## Out of scope (cannot or should not be cloned)

- FieldRoutes' API, data, and payment processor. Imports come only from files customers export themselves (FR-MIG-03).
- Door-to-door sales app, marketing websites, fleet GPS (PRD non-goals, P3).
- The original's partner integrations and add-on marketplace.

## Size

Screens 21, flows 11, entities 28 tables. Hard parts: offline sync with zero data loss (F05), idempotent money movement (F06, F07), migration with reconcile and rollback (F09). Size: L (a quarter for one builder), matching PRD milestones M0 to M7.
