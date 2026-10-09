import { CONSENT_COOKIE } from "@/lib/consent";

// CR-13, CR-17: facts the legal pages share, kept in one place so the privacy
// policy, cookie policy, DPA and field staff notice can't disagree. Change a
// fact here, bump LEGAL_UPDATED, and every page says the same new thing.

export const LEGAL_UPDATED = "October 9, 2026";

/**
 * The business-level product data setting (tenants.data_sharing), built by the
 * product analytics work. Source of truth: its data collection contract v1
 * (project files privacy/data-collection-contract.md, 2026-10-09).
 * Keep these summaries in step with what that code actually collects.
 */
export const PRODUCT_DATA_LEVELS = [
  {
    key: "none",
    label: "Off",
    summary: "we record no product events or error reports from your office app, technician app or customer account pages. This is the setting until an owner chooses, which we ask during setup. Turning it off later deletes every stored event that carries your business.",
  },
  {
    key: "anonymous",
    label: "Anonymous",
    summary:
      "we record errors and feature use with no business id, no person and no customer data, so the records can't be traced back to your business, even by us.",
  },
  {
    key: "identified",
    label: "Shared with your business name",
    summary: "the same events, tagged with your business (never a person) so we can see a problem you hit and help. Switching back to anonymous removes your business from past events.",
  },
] as const;

/** What anonymous measurement records and why, shown in the banner before anyone opts in. Exactly the contract v1.1 event catalog: add a line here before a new kind of event ships. */
export const MEASURED = [
  { what: "Errors and crashes", why: "so we can fix them, often before you notice", detail: "the kind of error, a cleaned-up message and the page pattern (like /customers/:id)" },
  { what: "Auto route results", why: "so route suggestions get better", detail: "whether a suggested route was accepted, changed, undone, or driven out of order, with the number of stops" },
] as const;

export const NEVER_MEASURED = "Times are rounded to the hour. Never recorded: names, addresses, phone numbers, emails, notes, photos, anything you type, your location, your IP address or a device id. No cookies are used for it, and it is deleted after 180 days.";

export const RETENTION = [
  { what: "Business records", howLong: "while the account is open. After it closes, the business has 30 days to export, then we delete them." },
  { what: "Pesticide application records", howLong: "at least 2 years, as state rules require, even if the business deletes the customer." },
  { what: "Change history", howLong: "as long as the record it describes." },
  { what: "Product improvement data", howLong: "180 days, then deleted automatically." },
  { what: "Request and error logs", howLong: "up to 30 days in our own logs, unless needed to investigate a security problem. Our hosting provider keeps its request logs for the period its service sets." },
  { what: "Backups", howLong: "deleted data leaves backups as they expire on our database provider's schedule." },
  { what: "Support emails", howLong: "up to 2 years after the conversation ends." },
  { what: "Billing records for our own plans", howLong: "7 years, for tax law." },
] as const;

export interface StorageItem {
  name: string;
  kind: "Cookie" | "Local storage" | "IndexedDB" | "Cache storage";
  purpose: string;
  duration: string;
  category: "Essential" | "Optional";
}

/** Every cookie and browser store the site and app use. The banner's promise depends on this list being complete. */
export const STORAGE: StorageItem[] = [
  { name: "sb-…-auth-token", kind: "Cookie", purpose: "Keeps you signed in to the app (set by our sign-in provider).", duration: "Until you sign out, refreshed while you use the app", category: "Essential" },
  { name: "rk_portal_…", kind: "Cookie", purpose: "Keeps a customer signed in to their account page with one business.", duration: "30 days", category: "Essential" },
  { name: CONSENT_COOKIE, kind: "Cookie", purpose: "Remembers your cookie choice so we don't ask on every page.", duration: "12 months", category: "Essential" },
  { name: "routeverde-tech", kind: "IndexedDB", purpose: "The technician app's offline copy of the day's visits and unsent work.", duration: "Until you sign out; signing out deletes it", category: "Essential" },
  { name: "rk-shell-…, rk-static-…", kind: "Cache storage", purpose: "Lets the technician app open with no signal.", duration: "Until the next app version", category: "Essential" },
  { name: "rk-tech-theme", kind: "Local storage", purpose: "Remembers the technician app's outdoor (high contrast) display setting.", duration: "Until changed", category: "Essential" },
];
