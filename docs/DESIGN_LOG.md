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
