// ENG-10: anything user-visible that is not finished stays behind a flag.
// Flip a flag in the same PR that finishes the feature, and add an entry to lib/changelog.ts.

export const FLAGS = {
  /** M2: map, drag and drop, optimizer. On since 2026-10-07; off falls back to the day list. */
  dispatchBoard: true,
  /** M3: offline technician PWA. On since 2026-10-07; off falls back to the online day list. */
  offlineTechApp: true,
  /** M4: invoices, payments, credits, collections, money reports. On since 2026-10-08. Card payments and autopay (stage 2) show only once Stripe keys are set and the business has connected its account. */
  billing: true,
  /** The Reports area. On since 2026-10-07 with product usage (FR-REC-06); billing reports join it with `billing`. */
  reports: true,
  /** M5: the import wizard (export is never flagged: leaving is promised from day one). On since 2026-10-08. */
  migration: true,
  /** M6: customer portal and email (FR-POR, FR-MSG). On since 2026-10-08; texts wait for an SMS provider. */
  portal: true,
} as const;

export type Flag = keyof typeof FLAGS;

export function isEnabled(flag: Flag): boolean {
  return FLAGS[flag];
}
