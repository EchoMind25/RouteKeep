// OPS-04: a business's choice about product improvement data
// (tenants.data_sharing, docs/DATA_COLLECTION.md section 1). Opt-in: every
// business starts at none and data_sharing_changed_at stays null until an owner
// or admin answers. The database trigger app.apply_data_sharing does the
// deleting; this file only words it. Copy follows the contract's onboarding bullets.

export const SHARING_LEVELS = ["none", "anonymous", "identified"] as const;
export type SharingLevel = (typeof SHARING_LEVELS)[number];

export const DEFAULT_SHARING: SharingLevel = "none";

export function isSharingLevel(v: unknown): v is SharingLevel {
  return typeof v === "string" && (SHARING_LEVELS as readonly string[]).includes(v);
}

export const SHARING_OPTIONS: Record<SharingLevel, { label: string; description: string }> = {
  none: {
    label: "Don't share anything",
    description: "RouteVerde stores no usage or error data from your business.",
  },
  anonymous: {
    label: "Share anonymously",
    description:
      "When something breaks, or when your team changes a suggested route, we record what happened with no business name, no people and no customer data, so we can fix errors faster and make auto routes match how you really drive.",
  },
  identified: {
    label: "Share with our business name",
    description: "The same, plus your business name, so we can spot a problem you are having and reach out before you have to.",
  },
};

/** Exactly what is recorded when a business shares (contract sections 3 and 4), in plain words. */
export const TRACKED: string[] = [
  "A page or request that fails: the kind of error, the error text with emails, phone numbers, numbers and quoted values removed, the page pattern (like /customers/:id) and the app version.",
  "An auto route: when one is proposed, saved, dismissed or undone, which planner made it, how many stops and the minutes it expected to save.",
  "A stop moved by hand on a lane that was auto-routed that day.",
  "A technician finishing a stop out of the published order: only the planned and actual position numbers.",
  "Times are rounded to the hour. Records are deleted after 180 days.",
];

export const HOW_IT_HELPS = "Errors you hit get fixed faster, and auto routes learn from the changes your team makes so they match how you really drive.";

export const NEVER_COLLECTED =
  "At every level we never collect customer names, addresses, contact details, notes, photos, payment details, who on your team did something, or anything anyone types.";

export const PERSON_CHOICE = "In the browser, reports also need each person's own yes in the cookie banner. Anyone can say no for themselves.";

/** What happens to data already stored when a business moves from one level to another. */
export function changeNotice(from: SharingLevel, to: SharingLevel): string | null {
  if (from === to) return null;
  if (to === "none") {
    return from === "identified"
      ? "Collection stops now, and every event already stored with your business name is deleted. Anonymous events stored earlier cannot be found or deleted, because nothing links them to you."
      : "Collection stops now. Anonymous events stored earlier cannot be found or deleted, because nothing links them to you.";
  }
  if (to === "anonymous" && from === "identified") return "Your business name is removed from every event already stored, and new events are stored without it.";
  if (to === "identified") return from === "anonymous" ? "From now on, new events carry your business name. Events stored before stay anonymous." : "Sharing with your business name starts now.";
  return "Anonymous sharing starts now.";
}

/** The confirmation after saving. Answering for the first time with none still deserves a plain answer. */
export function savedMessage(from: SharingLevel | null, to: SharingLevel): string {
  const notice = from ? changeNotice(from, to) : null;
  if (notice) return `Saved. ${notice}`;
  return to === "none" ? "Saved. Nothing is shared from your business." : "Saved.";
}
