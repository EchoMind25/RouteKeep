import { instantToZoned, type LocalDate } from "@/lib/domain/time";

// Display formatting. Calendar dates are formatted at UTC midnight so the
// weekday never shifts with the viewer's or the server's zone.

const dateFormats = {
  short: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }),
  weekday: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }),
  long: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  full: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }),
} as const;

export function formatLocalDate(date: LocalDate | string | null | undefined, style: keyof typeof dateFormats = "weekday"): string {
  if (!date) return "";
  return dateFormats[style].format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

/** "08:00" -> "8:00 AM" */
export function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** An instant shown on the business's own clock, e.g. "Oct 6, 2026, 9:05 AM" (ENG-05: never the server's zone). */
export function formatInstant(instant: Date | string | null | undefined, timeZone: string): string {
  if (!instant) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}

/** A deadline on the business's clock, short: "9:12 AM" if it falls today there, else "Thu 9:12 AM" (CR-02). */
export function formatDeadline(instant: Date, timeZone: string, now: Date): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
  if (instantToZoned(instant, timeZone).date === instantToZoned(now, timeZone).date) return time;
  return `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant)} ${time}`;
}

export function formatWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "Any time";
  if (start && end) return `${formatTime(start)} - ${formatTime(end)}`;
  return start ? `After ${formatTime(start)}` : `Before ${formatTime(end)}`;
}

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  unscheduled: { label: "Needs a date", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  in_progress: { label: "In progress", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  skipped: { label: "Skipped", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const SUBSCRIPTION_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const BILLING_MODE: Record<string, string> = {
  per_service: "After each visit",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Yearly",
};

export const CATEGORY_LABEL: Record<string, string> = {
  pest: "Pest",
  lawn: "Lawn",
  termite: "Termite",
  mosquito: "Mosquito",
};

export const PRODUCT_KIND: Record<string, string> = {
  pesticide: "Pesticide",
  minimum_risk: "Minimum-risk, FIFRA 25(b)",
  fertilizer: "Fertilizer",
  other: "Other",
};

export const SIGNAL_WORD: Record<string, string> = {
  caution: "Caution",
  warning: "Warning",
  danger: "Danger",
  danger_poison: "Danger / Poison",
};

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
