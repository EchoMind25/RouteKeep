# Design log

ENG-13 / R-LEGAL-03: a dated record of how each feature was derived, kept as
evidence of independent (clean-room) development. Inputs allowed: our own PRD
and research brief, public regulation text, public reviews as summarised in
RESEARCH.md, official vendor documentation, and files customers export
themselves. Never: competitor code, UI assets, help text, marketing copy,
screenshots, logins or API keys.

## 2026-10-06: project kickoff (M0, M1)

Inputs: `docs/PRD.md` v1.0, `docs/RESEARCH.md`. No competitor product, account,
screenshot or help page was opened during this work.

- Screen inventory and flows (`replica/recon.md`) were written from the PRD's
  functional requirements, not from the incumbent's menus. `replica/screens/`
  is empty on purpose (R-UX-02).
- Data model: PRD section 7 plus Utah Admin. Code R68-7-11(11) fields as listed
  in RESEARCH 7.1 (CR-01). Snapshotting CR-01 fields on each application row is
  our own design choice to keep records immutable in meaning.
- Visual identity: original. Cool neutrals with one rust accent chosen for
  legibility on map tiles; Geist type; Phosphor icons; no reference to any
  competitor's colours, layout or iconography (UX-06). Contrast verified for
  every text pair in light, dark and outdoor themes.
- Recurrence: RFC 5545 subset; month-end clamping is our own rule, chosen
  because skipping months for customers on the 29th to 31st loses visits.
- Units and mix rates: typed units with percent stored as percent, designed
  against the failure class in R-BUG-07 (percent versus decimal confusion).
- Copy: all labels, hints and empty states written fresh for this product.
- Demo data: invented people and businesses; product EPA numbers use company
  number 0, which is never assigned, so demo labels cannot be mistaken for real
  ones.

Open items affecting derivation:
- Import presets (FR-MIG-01) will be built only from files a pilot customer
  exports (FR-MIG-03). None exist yet.
- No seed product catalog with real EPA numbers ships until the owner supplies
  a verified list (FR-SET-03); the app accepts custom products today.

## 2026-10-07: dispatch board and pin check (M2)

Inputs: `docs/PRD.md` FR-DSP-01..06, FR-CRM-02, D-07, D-08; RESEARCH R-BUG-05,
R-BUG-06, R-PAIN-08 as summarised there; MapLibre, react-map-gl and dnd-kit
documentation. No competitor product, account, screenshot or help page was
opened.

- Layout: lanes beside the map, with the queue above the map so both stay in
  view while the lanes scroll (FR-DSP-04). On narrow screens the queue comes
  first and the map last. Our own arrangement, chosen from the requirement.
- Results show in a corner toast so the board never shifts under the pointer.
- Stop numbers on the map appear for the route in focus (or every route on a
  light day) to stay legible; selecting a stop focuses its route.
- Optimizer: our own heuristic (window groups, nearest neighbour, 2-opt,
  schedule-aware insertion and relocate search) built from textbook methods.
- Long-leg rule (FR-DSP-06) attributes the leg out of a misplaced stop to that
  stop, so the next, correctly placed stop is not sent for a pin check.
- No basemap by default: the tile host is the owner's choice (D-08) because it
  sees which areas are viewed.

## 2026-10-07: technician app (M3)

Inputs: `docs/PRD.md` FR-TEC-01..11, FR-REC-01, FR-REC-05, NFR-01, NFR-02,
CR-01, CR-05; RESEARCH R-BUG-01, R-BUG-07 as summarised there; Utah Admin.
Code R68-7-11(11) fields via RESEARCH 7.1; MDN and W3C service worker and
IndexedDB documentation. No competitor app, account, screenshot or help page
was opened.

- Flow order and step names come from FR-TEC-03 as written. Layout is our
  own: one column, a progress bar, the primary action at the bottom.
- Target site and pest suggestions are generic industry terms, written fresh.
- Sync: snapshot down and idempotent mutations up, our own design from the
  PRD's conflict rule (NFR-02); textbook outbox pattern.
- Outdoor mode uses the outdoor token set designed in M1.
- Field work review (NFR-02): the queue, its one-sentence explanation of
  each clash and the two choices (take the field's version, or keep the
  office's) are derived from the PRD's conflict rule alone. Records are never
  discarded by a choice, which follows from FR-REC-03 and CR-04.

