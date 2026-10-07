# Build log

One line per screen: id, date, state, what is missing, what was harder than expected.

| Screen | Date | State | Missing | Notes |
| --- | --- | --- | --- | --- |
| S01 Sign in | 2026-10-06 | done | MFA enrolment (CR-15) | Email one-time code, not a magic link: links open Safari instead of an installed PWA |
| S02 Create business | 2026-10-06 | done | | Double submit returns the same tenant (client key) |
| S03 Setup checklist | 2026-10-06 | done | Stripe, 10DLC and import steps (M4 to M6) | |
| S04 Schedule board | 2026-10-07 | done | Google and VROOM optimizer adapters | Hardest parts: a plain reorder never bumped the route's version (the trigger ignores no-op updates), so writes now compare the lane's order itself; MapLibre 6 looks for its worker next to its own chunk, so the worker is copied to `public/vendor`. 500 stops hydrate with the map drawn in about 0.7 to 1 s locally |
| S05 Optimize preview | 2026-10-07 | done | | The first heuristic made windowed stops late to save distance; proposals are now scored on lateness first and never worse than the current order |
| S06 Customers | 2026-10-06 | done | Status filter | Search covers name, email, phone digits and street |
| S07 Customer detail | 2026-10-06 | partial | Edit, add property, timeline beyond visits, skip/pause/cancel | |
| S08 New customer + plan | 2026-10-06 | done | | Schedule preview uses the same recurrence code as generation |
| S09 Property pin | 2026-10-07 | done | A street map needs `NEXT_PUBLIC_MAP_STYLE_URL` | A page, not a dialog: the map needs room. Keyboard path: pan to the crosshair, or type coordinates |
| S10 Appointment | | not started | | Next: edit one / this and future (FR-SUB-03) |
| S11 Billing, S12 Take payment | | not started | | M4, schema ready |
| S13 Reports | | not started | | |
| S14 Settings | 2026-10-06 | partial | Edit and retire technicians, products and service types; member role changes | Business, team invites, technicians, plans, products |
| S15 Import, S16 Export | | not started | | M5, schema ready |
| S17 Technician day | 2026-10-06 | interim | Offline PWA (M3) | Online list with navigate links, clearly labelled |
| S18 Stop flow | | not started | | M3 |
| S19, S20 Portal | | not started | | M6 |
| S21 Design primitives | | not started | | |
