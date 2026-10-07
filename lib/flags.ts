// ENG-10: anything user-visible that is not finished stays behind a flag.
// Flip a flag in the same PR that finishes the feature, and add an entry to lib/changelog.ts.

export const FLAGS = {
  /** M2: map, drag and drop, optimizer. On since 2026-10-07; off falls back to the day list. */
  dispatchBoard: true,
  /** M3: offline technician PWA. Until then technicians get an online day list. */
  offlineTechApp: false,
  /** M4: invoices, autopay, ledger screens. */
  billing: false,
  /** M4+: revenue, AR aging, product usage. */
  reports: false,
  /** M5: import wizard and export. */
  migration: false,
  /** M6: customer portal. */
  portal: false,
} as const;

export type Flag = keyof typeof FLAGS;

export function isEnabled(flag: Flag): boolean {
  return FLAGS[flag];
}
