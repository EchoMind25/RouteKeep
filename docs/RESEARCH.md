# Routewright Research

Path in repo: `docs/RESEARCH.md`
Companion: `docs/PRD.md` (normative). This file is informative background only.
Last updated: 2026-10-06

## How to use this file (for Claude and other agents)

- This file explains WHY. `docs/PRD.md` says WHAT to build. If they conflict, the PRD wins.
- Do not treat anything here as a requirement unless the PRD references it by ID (for example `R-BUG-03`).
- Evidence labels on every claim:
  - `[C]` confirmed from a vendor, government, or regulatory primary source
  - `[R]` reported by users or third-party sites, not vendor-confirmed
  - `[I]` inference or analysis
  - `[U]` unverified, do not rely on it without checking
- Clean-room rule: never copy FieldRoutes code, UI assets, help text, or marketing copy. Never use a FieldRoutes account or API credentials to study the product. Feature parity is derived only from public material and customer-supplied export files.

## 1. Product under study: FieldRoutes

### 1.1 Background

- R-BG-01 `[C]` FieldRoutes (formerly PestRoutes) is field service software for pest control and lawn care, based in McKinney, TX.
- R-BG-02 `[C]` ServiceTitan announced the acquisition on 2022-01-04. ServiceTitan's 10-K reports $576.9M cash for FSH Topco LLC dba PestRoutes.
- R-BG-03 `[C]` ServSuite (from ServicePro) now sits under FieldRoutes as "ServSuite by FieldRoutes".
- R-BG-04 `[C]` March 2023 "Data Declaration": self-serve CSV export, full extracts on migration, payment tokens within 10 business days at no charge.
- R-BG-05 `[I]` Positioning is growth-to-enterprise pest control. FieldRoutes says 40 of the PCT Top 100 are customers. Small operators are not the focus.

### 1.2 Feature inventory (parity reference)

| ID | Area | What exists publicly |
|---|---|---|
| R-FEAT-01 | CRM | Customer accounts, multiple properties, notes, balances, service history, commercial multi-location |
| R-FEAT-02 | Recurring plans | Subscriptions, renewals, renewal reminders, recurring billing |
| R-FEAT-03 | Scheduling | Scheduler, reminders, visual grouping |
| R-FEAT-04 | Routing | Route optimization (a top-praised strength `[R]`) |
| R-FEAT-05 | Dispatch | Map planning, reschedule, technician tracking, fleet add-on |
| R-FEAT-06 | Technician mobile | Routes, complete appointments, products used, notes, payments, signatures, photos, forms, offline mode |
| R-FEAT-07 | Chemical compliance | Product usage entry, dilution calculator, material lists |
| R-FEAT-08 | Billing | AutoPay, invoices by text, email, mail; in-house payments product |
| R-FEAT-09 | Customer portal | Branded portal |
| R-FEAT-10 | Communications | Automated SMS, email, voice |
| R-FEAT-11 | Sales | Door-to-door app, contracts, e-signature, leads, rep stats |
| R-FEAT-12 | Marketing | Websites, online booking, marketing add-on |
| R-FEAT-13 | Reporting | Real-time reports (users report workarounds `[R]`) |
| R-FEAT-14 | Multi-office | Locations and territories |
| R-FEAT-15 | API | REST, tenant subdomain, key and token in query string `[R]` |
| R-FEAT-16 | Export | Self-serve CSV of core customer fields `[C]` |

- R-FEAT-17 `[U]` The official API reference was not reviewed. The entity list (customer, subscription, appointment, route, employee, office, ticket or invoice, payment, product use, note, document, lead, contract) is inferred. Validate import mappings against real export files from a switching customer.

### 1.3 Pricing and contracts (all `[R]` unless marked)

- R-PRICE-01 Listing sites show $350/month starting; vendor text on G2 says $350 per 1,000 active customers. Other sites say $199. Conflict unresolved.
- R-PRICE-02 Typical small to mid range $200 to $600/month. One reviewer under 500 customers paid about $364/month.
- R-PRICE-03 Implementation fee reported at $1,300+.
- R-PRICE-04 Contracts of 12 months reported; one reviewer reports 2 years and a cancellation cost over $1,000.
- R-PRICE-05 SMS reported at $0.04 per text sent and received.
- R-PRICE-06 Reviewers say the in-house payment processor is mandatory and card fees could not be passed through.
- R-PRICE-07 Pricing is by customer count, not seats. Users like this because seasonal staff cost nothing.

## 2. What owners dislike

Ratings: Capterra about 4.2/5 (337 reviews). iOS app 3.5/5. Google Play app 1.9/5 (210 reviews). `[R]`

`[I]` The gap between the office web app and the mobile app is the clearest signal in the data.

| ID | Theme | Severity | Evidence summary `[R]` |
|---|---|---|---|
| R-PAIN-01 | Mobile app crashes, reloads, offline failure | Critical | App reloads when backgrounded or during a call, loses notes and material entries, long freezes searching for signal, slow route loads, erased text input |
| R-PAIN-02 | Support slow or inconsistent | High | Multi-day waits, slow ticket closure; others praise support, so it varies |
| R-PAIN-03 | Contracts and cancellation | High | Long terms, cancellation fees, sales misstatements |
| R-PAIN-04 | Opaque and high pricing | Medium | Quote-only pricing, per-text fees, mandatory processor |
| R-PAIN-05 | Data export when leaving | High (mostly historical) | Older report of a paid, partial backup. Vendor now pledges portability (R-BG-04) |
| R-PAIN-06 | Learning curve, too many clicks | Medium | Dense, click-heavy office UI |
| R-PAIN-07 | Lawn care is second-class | High in lawn segment | Mix rates hard to set up, product geared to pest |
| R-PAIN-08 | Reporting gaps | Medium | Workarounds needed; cancelled and skipped work hard to find |
| R-PAIN-09 | Release regressions | Medium | Updates ship with bugs and without notice |
| R-PAIN-10 | Wrong map pins | High per incident | Bad geocode sent a technician to another city; map zoom resets; stop numbers differ between map and list |
| R-PAIN-11 | Integration sync silently failing | Medium | Automatic sync required daily manual runs |
| R-PAIN-12 | Slowness | Medium | Slow at times, routes slow to open |
| R-PAIN-13 | Unexpected messaging charges | Medium | Charged for messages the customer did not believe they sent |

What users like, do not regress: routing and scheduling, automated recurring billing and renewals, all-in-one scope, pricing by customer count, fast staff training once learned.

Underserved segments `[I]`: (1) solo to 5 truck operators priced out, (2) lawn fertilization and weed control operators, (3) mixed pest and lawn shops in the Mountain West, (4) rural operators who need true offline.

## 3. Reported bugs and failure classes, with prevention

Outage history `[R]`: third-party monitors count dozens of incidents since late 2022 across about 19 status components, including a recurring billing and invoice email disruption on 2025-10-15. No public security breach specific to FieldRoutes was found `[U]`.

| ID | Failure class | Source | Likely cause `[I]` | Prevention (see PRD ENG rules) |
|---|---|---|---|---|
| R-BUG-01 | App state lost on background or kill | App store reviews | In-memory form state | Persist every edit to local storage immediately; restore on resume |
| R-BUG-02 | Offline freezes, slow route load | App store reviews | Online-first design, blocking calls | Local-first reads; UI never waits on network |
| R-BUG-03 | Duplicate card charges after offline payment | Vendor release note | Non-idempotent retry | Client-generated payment key, processor idempotency key, unique DB constraint |
| R-BUG-04 | Recurring billing run fails mid-batch | Status history | Monolithic batch job | Per-invoice durable steps, unique invoice per period |
| R-BUG-05 | Wrong geocode pins | App store review | No confidence check | Confidence threshold, human confirm, lockable pin, leg-time outlier check |
| R-BUG-06 | Map viewport reset, inconsistent stop numbers | App store review | UI state not persisted | Persist viewport; one sequence number everywhere |
| R-BUG-07 | Dilution unit confusion | App store review | Percent vs decimal input | Typed units, live preview, property tests |
| R-BUG-08 | Text input erased | Play review | Re-render race during sync | Uncontrolled inputs, debounced persistence |
| R-BUG-09 | Silent integration sync failure | Review site | No observability | Tenant-visible sync log, staleness alert |
| R-BUG-10 | Unexplained messaging charges | Review site | Opaque metering | Usage ledger tied to message rows |
| R-BUG-11 | Inconsistent reports | Review site | Reports from mutable rows | Append-only ledger, reconciliation job |
| R-BUG-12 | DST and recurrence errors | General class `[I]` | UTC offsets stored | Local date + local time + IANA zone; RRULE tests across DST |
| R-BUG-13 | Double booking, lost updates | General class `[I]` | No concurrency control | Version column, exclusion constraints |
| R-BUG-14 | Cross-tenant data leak | General class `[I]` | Missing tenant filter | RLS on every table plus automated cross-tenant tests |
| R-BUG-15 | Duplicate notifications | General class `[I]` | Retried webhook or job | Outbox with unique key; dedupe inbound webhooks by provider event id |
| R-BUG-16 | Release regressions | Review site | Weak QA | Feature flags, E2E tests on critical flows, changelog |

## 4. Competitive landscape

| Product | Segment | Pricing `[R]` | Notes |
|---|---|---|---|
| FieldRoutes | Growth to enterprise pest | $199 to $600+/month, setup fee, annual+ contract | See sections 1 to 3 |
| PestPac (WorkWave) | Mid to enterprise pest | From about $199/month | Deep commercial features; dated UI reported |
| GorillaDesk | 1 to 15 techs, pest, lawn, pool | About $49 to $99 per route, higher growth tier | Highly rated, simple, no contract; some features gated by tier |
| Jobber | Generic home services | From about $29 to $39/month | Polished; no pest chemical compliance |
| Housecall Pro | Generic home services | From about $59 to $79/month | Not pest-specific |
| Briostack, Pocomos, PestBoss, Service Autopilot, RealGreen, Fieldwork | Various | `[U]` not researched | Research before launch |

Differentiation to own `[I]`:
1. Published pricing, month to month, no setup fee, self-serve migration.
2. Offline-first technician app as the headline.
3. Customer-owned data: instant self-serve full export.
4. Pest and lawn parity from day one.
5. Processor transparency and compliant fee pass-through options.
6. AI assist (Phase 2): intake to booking, note drafting, record validation.

## 5. UX findings

- R-UX-01 `[R]` Office app is dense and click-heavy. Mobile app has viewport resets, buried call-ahead info, and blocking reloads.
- R-UX-02 `[U]` No FieldRoutes screenshots were reviewed. Visual claims beyond user commentary are unverified.
- R-UX-03 `[I]` Recommended patterns: split timeline plus map dispatch board with shared selection; optimization preview with diff and undo; always-visible skipped and cancelled queue; one-handed technician stepper flow with a persistent sync chip; passwordless customer portal; guided import wizard; WCAG 2.2 AA and a high-contrast outdoor mode.

## 6. Technology and vendor findings

### 6.1 Verified on 2026-10-06 (third-party summaries of vendor pricing unless marked)

| ID | Vendor | Finding |
|---|---|---|
| R-TECH-01 | Supabase Free | 500 MB database, 1 GB storage, 2 projects, pauses after 7 days of inactivity, no automatic backups |
| R-TECH-02 | Supabase Pro | $25/month, 8 GB database, daily backups kept 7 days, no pausing. Compute above the base size costs extra |
| R-TECH-03 | Netlify Free | Commercial use allowed. Accounts created after 2025-09-04 get 300 credits/month as a hard cap and sites pause at the cap. Older accounts keep 100 GB bandwidth and 300 build minutes. Personal plan $9/month with 1,000 credits |
| R-TECH-04 | Netlify functions | Synchronous limit 60 seconds; background functions up to 15 minutes (from earlier research) |
| R-TECH-05 | Vercel | Hobby plan is non-commercial only. Pro is $20 per seat with longer function durations |
| R-TECH-06 | PowerSync Cloud Free `[C]` | Up to 2 GB synced/month, 500 MB hosted, 50 peak concurrent connections, deactivated after 1 week of inactivity. Pro starts at $49/month. A free source-available self-hosted edition exists |
| R-TECH-07 | Stripe Connect | When Stripe sets pricing and connected accounts pay processing fees (Standard-style accounts with direct charges), the platform pays no extra Connect fees. Platform can add an application fee |
| R-TECH-08 | Google Maps Platform `[C]` | 10,000 free calls per Essentials SKU per month, including Geocoding |
| R-TECH-09 | Google Route Optimization | Single-vehicle routing: 5,000 free shipments/month then about $10 per 1,000. Fleet routing: 1,000 free then about $30 per 1,000 at the first tier (from earlier research) |
| R-TECH-10 | Twilio A2P 10DLC | Per tenant brand: about $4.50 low-volume brand fee, $15 campaign vetting, $1.50 to $10/month campaign fee (from earlier research) |

### 6.2 Not verified `[U]`

Free tier limits for Inngest, Sentry, Resend, Better Stack; exact current library versions; Apple and Google developer program fees ($99/year and $25 one time are the long-standing figures); toll-free verification cost; iOS installed-PWA storage persistence behavior.

### 6.3 Routing engine options

| Option | Cost | Privacy | Verdict |
|---|---|---|---|
| Google Route Optimization, single-vehicle | Free tier covers a small operator | Addresses sent to Google | Launch default (cost) |
| VROOM + OSRM self-hosted | Server cost only | Data stays on our infrastructure | Target state (privacy, scale) |
| OR-Tools | Free library, more engineering | Self-hosted | Only if VROOM constraints fall short |

## 7. Compliance and legal findings

### 7.1 Utah pesticide records `[C]` (Utah Admin. Code R68-7-11(11), R68-7-16)

- R-COMP-01 Commercial applicators must record each application within 24 hours.
- R-COMP-02 Required fields: customer name and address; application address if different; size of area treated; specific target sites; date and time; brand name; EPA registration number; mix rate; total amount applied per location; purpose and target pest; applicator name, business address, license number.
- R-COMP-03 Business name and license number must appear on service records and notices.
- R-COMP-04 Restricted-use products with Danger or Danger-Poison signal words require a written customer statement before application.
- R-COMP-05 Termite treatments require a structure diagram.
- R-COMP-06 Retention is two years in the rule text reviewed. Confirm the current clause with UDAF `[U]`.
- R-COMP-07 `[U]` Other states vary in fields and retention. Build records as a per-state template.

### 7.2 Payments, messaging, contracts `[U]` general background, confirm with counsel and processor

- R-COMP-08 PCI: processor-hosted card fields keep scope minimal. Never store card numbers, including offline.
- R-COMP-09 ACH: recurring debits need a revocable authorization; the processor mandate flow covers capture.
- R-COMP-10 Surcharging is restricted by card networks and some states; debit cannot be surcharged.
- R-COMP-11 SMS: express consent with timestamp and source, STOP and HELP handling, quiet hours, and a registered 10DLC brand and campaign per tenant before sending.
- R-COMP-12 Email: unsubscribe link and physical address on marketing mail.
- R-COMP-13 Door-to-door sales: 3 business day cooling-off notice on qualifying sales (Phase 3 scope).
- R-COMP-14 E-signature: intent, consent to electronic records, attribution, retention.

### 7.3 Privacy and security

- R-COMP-15 `[U]` Utah Consumer Privacy Act thresholds likely exclude most small tenants, but offer a DPA, export, deletion, and breach notice anyway.
- R-COMP-16 `[I]` SOC 2 becomes a buyer question around customers 20 to 50. Not needed to sign customer 1.

### 7.4 Clean-room boundaries (not legal advice)

- R-LEGAL-01 Generally safe: replicating functions, workflows, and data fields; importing customer-exported files; truthful comparative naming.
- R-LEGAL-02 Not safe: copying code, UI graphics, help text, marketing copy; confusing trade dress; using competitor accounts or API docs under terms that forbid competitive use.
- R-LEGAL-03 Keep a dated design log showing independent derivation.

### 7.5 Name

- R-NAME-01 `[U]` "Routewright" showed no identical software trademark in web search, but USPTO and WHOIS were not checked. An unrelated Florida LLC and some hobby GitHub projects use the name. Backup: Routeverde.

## 8. Market

- R-MKT-01 `[R]` US pest control business counts conflict by source: roughly 16,500 to 34,000. Most firms operate 1 to 2 locations.
- R-MKT-02 `[R]` About 85% of residential pest revenue is recurring.
- R-MKT-03 `[U]` Software market size estimates are unreliable. FieldRoutes customer count is reported between 1,700 and 3,000+.
- R-MKT-04 `[I]` Switching triggers: contract renewal, price increase, mobile failures in peak season, a billing support failure, adding lawn services.
- R-MKT-05 `[I]` Wedge: Utah and Mountain West operators with 1 to 10 trucks and 200 to 3,000 recurring customers.

## 9. Lean launch cost findings (target: under $100 total cash to sign customer 1)

`[I]` based on section 6.1. See PRD section 5 for the binding decisions.

| Item | Original plan | Lean plan | Compliance impact |
|---|---|---|---|
| Hosting | Vercel Pro $20/month | Netlify Free (commercial use allowed) | None. Vercel Hobby would breach its terms for a paid product |
| Database | Supabase Pro $25/month from day 1 | Supabase Free while only seed data exists; Pro from the first real customer record | Backups are required once real compliance records exist |
| Technician app | Native app, $99/year + $25 store fees | Installable offline PWA; native wrapper later | None. Product risk on iOS storage, see PRD risk table |
| Route optimization | Self-hosted worker $10 to $25/month | Google single-vehicle free tier behind an adapter | None. Privacy tradeoff: addresses go to Google |
| Offline sync | PowerSync, price unknown | PowerSync Free; Pro ($49) or self-host on trigger | None |
| SMS | Twilio from day 1 | Email first; register 10DLC per tenant at onboarding, pass cost through | Registration cannot be skipped before sending SMS |
| Payments | Stripe Connect Express | Stripe Standard-style accounts, direct charges | None. Lower platform liability |
| Jobs, errors, email | Paid tiers | Free tiers `[U]` | None |
| Legal, trademark, SOC 2 | Budgeted | Deferred | Deferred risk, not removed |

Estimated cash: about $12 (domain) before signing; about $25 (Supabase Pro) plus about $21 (tenant 10DLC, pass-through) in the go-live month. Total about $58, leaving about $40 of buffer.

## 10. Known gaps

- Competitors in section 4 marked `[U]`.
- Reddit, LawnSite, Facebook, and YouTube discussions were not reviewed.
- Official FieldRoutes API reference and real export file layouts were not reviewed.
- Complaint frequency and severity are qualitative estimates from sampled reviews.
- Legal content is background, not advice.

## 11. Source list (names only; re-fetch before quoting)

ServiceTitan press release and 10-K; FieldRoutes product pages, blog, status page, Data Declaration; Capterra, Software Advice, GetApp, G2 listings; Apple App Store and Google Play listings for FieldRoutes Mobile; IsDown and StatusGator; Utah Admin. Code R68-7 (Cornell LII and Utah rules site); Supabase, Netlify, Vercel, PowerSync, Stripe, Google Maps Platform, Twilio pricing and docs; IBISWorld, Briostack, and SchedulingKit industry statistics.
