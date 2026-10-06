# Components

Design read: operational B2B web app (office dashboard, outdoor technician PWA,
customer portal) for small pest and lawn operators, calm and trust-first, dense
but readable. Dials: DESIGN_VARIANCE 3, MOTION_INTENSITY 2 (feedback only),
VISUAL_DENSITY 6 office / 3 technician. Taste-skill landing-page rules (hero,
scroll motion) do not apply; typography, colour, layout discipline, a11y and
AI-tell rules do.

Shape rule: controls 6 px (`rounded-control`), panels 10 px (`rounded-panel`),
badges pills. Focus: 2 px outline in `fg` (neutral; an accent-coloured ring read
as an error state on inputs). Icons: Phosphor, regular weight, filled when active.
Numbers that people compare use `.tabular`.

| Component | File | Variants | States | a11y | Used on |
| --- | --- | --- | --- | --- | --- |
| Button | `components/ui/button.tsx` | primary, secondary, ghost, danger, link; sm 32, md 36, lg 48, icon | hover, active (scale 0.98), focus-visible, disabled, loading (`aria-busy`, label kept) | real `<button>`, or `asChild` for links | everywhere |
| SubmitButton | `components/ui/form-status.tsx` | as Button | pending label while the action runs; blocks double submit | `useFormStatus` | all forms |
| Field | `components/ui/field.tsx` | wraps Input, Select, Textarea | hint, error, optional tag | label above, hint and error wired with `aria-describedby`, `aria-invalid` | all forms |
| Input / Select / Textarea | same | native controls | focus, invalid, disabled | 16 px font below md so iOS never zooms | all forms |
| Checkbox | same | with hint | checked, focus | label + hint linked | consent, autopay, restricted use |
| Fieldset | same | legend + description | | `<fieldset>`/`<legend>` | S02, S08 |
| Badge | `components/ui/badge.tsx` | neutral, accent, success, warning, danger | static | text always says the state (colour is never the only cue) | lists, detail pages |
| Panel / PanelHeader | `components/ui/layout.tsx` | raised surface | | `<section>` | detail pages |
| PageHeader | same | title, description, back link, actions | | one `<h1>` per page | every page |
| EmptyState | same | icon, title, body, actions | | teaches the next step (UX-04) | lists, schedule |
| Alert | same | neutral, success, warning, danger | | `role=alert` for danger, `status` otherwise | forms, banners |
| Details | same | label/value list | | `<dl>` | customer contact |
| Skeleton | same | block | pulse (off under reduced motion) | `aria-hidden` | loading states |
| Table | `components/ui/table.tsx` | dense | hover row | labelled, focusable scroll region (WCAG 2.1.1, found by axe at 390 px) | lists |
| Dialog | `components/ui/dialog.tsx` | default | open | Radix focus trap, title + description, close button labelled | M2 optimize preview, pin confirm |
| Office nav | `components/office/nav.tsx` | sidebar (lg), scrolling bar (mobile) | active (`aria-current`) | `<nav aria-label="Main">` | office shell |
| Stop row / lane | `app/(office)/schedule/page.tsx` | lane per technician, unassigned lane | first visit, check pin, status | stop number has an accessible label; lane colour paired with initials | S04 |

Route colours (`tokens.route`, NFR-05): Okabe-Ito then Paul Tol muted, each
with an ink colour that passes AA (`tokens.route_ink`, checked at build).

Still to build: Tabs (customer timeline), Toast (only for transient events),
SyncChip and Stepper (M3), map pin and lane drag (M2).
