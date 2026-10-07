# Build log

One line per screen: id, date, state, what is missing, what was harder than expected.

| Screen | Date | State | Missing | Notes |
| --- | --- | --- | --- | --- |
| S01 Sign in | 2026-10-06 | done | MFA enrolment (CR-15) | Email one-time code, not a magic link: links open Safari instead of an installed PWA |
| S02 Create business | 2026-10-06 | done | | Double submit returns the same tenant (client key) |
| S03 Setup checklist | 2026-10-06 | done | Stripe, 10DLC and import steps (M4 to M6) | |
| S04 Schedule board | 2026-10-07 | done | Google and VROOM optimizer adapters | Hardest parts: a plain reorder never bumped the route's version (the trigger ignores no-op updates), so writes now compare the lane's order itself; MapLibre 6 looks for its worker next to its own chunk, so the worker is copied to `public/vendor`. 500 stops hydrate with the map drawn in about 0.7 to 1 s locally |
| S04b Field work review | 2026-10-07 | done | | NFR-02's review queue: reached from a banner on the board. Each item says in one sentence what the phone did and what the office had changed |
| S05 Optimize preview | 2026-10-07 | done | | The first heuristic made windowed stops late to save distance; proposals are now scored on lateness first and never worse than the current order |
| S06 Customers | 2026-10-06 | done | Status filter | Search covers name, email, phone digits and street |
| S07 Customer detail | 2026-10-06 | partial | Edit, add property, timeline beyond visits, skip/pause/cancel | |
| S08 New customer + plan | 2026-10-06 | done | | Schedule preview uses the same recurrence code as generation |
| S09 Property pin | 2026-10-07 | done | A street map needs `NEXT_PUBLIC_MAP_STYLE_URL` | A page, not a dialog: the map needs room. Keyboard path: pan to the crosshair, or type coordinates |
| S10 Appointment | 2026-10-07 | done | | Move, skip, cancel, restore; the service record (products, notes, photos, signature) and its PDF once the stop is done; CR-02 record status while started and on each record |
| S11 Billing, S12 Take payment | | not started | | M4, schema ready |
| S13 Reports | | not started | | |
| S14 Settings | 2026-10-06 | partial | Edit and retire technicians, products and service types; member role changes | Business, team invites, technicians, plans, products |
| S15 Import, S16 Export | | not started | | M5, schema ready |
| S17 Technician day | 2026-10-07 | done | | Offline-first; the page carries no route data, so the saved copy works for any day. A sign-in lands on /tech by client-side navigation, outside the worker's scope, so `serviceWorker.ready` never settles there: the app messages the worker on activation instead. Stops from an earlier day still on the phone are listed (and openable) even when today is empty; CR-02 deadline badges from 20 h |
| S18 Stop flow | 2026-10-07 | done | | A resumed stop opens the product card that still needs input; card state was in memory only and a killed tab came back collapsed |
| S19, S20 Portal | | not started | | M6 |
| S21 Design primitives | | not started | | |
