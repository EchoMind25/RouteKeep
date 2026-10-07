import { addDays, dateParts, daysBetween, daysInMonth, makeLocalDate, type LocalDate } from "./time";

// FR-BIL-01: which invoice a finished visit belongs on. A plan billed per
// service gets one invoice per visit. A plan billed monthly, quarterly or
// yearly gets one invoice per period, listing that period's visits at the
// per-visit price, issued once the period is over (owner can rerun any time;
// periods never double-invoice: invoices_period is unique).

export type BillingMode = "per_service" | "monthly" | "quarterly" | "annually";

export interface BillingPeriod {
  key: string;
  start: LocalDate;
  end: LocalDate;
}

export function billingPeriod(date: LocalDate, mode: BillingMode): BillingPeriod {
  const { year, month } = dateParts(date);
  if (mode === "per_service") return { key: date, start: date, end: date };
  if (mode === "monthly") {
    return { key: `${year}-${String(month).padStart(2, "0")}`, start: makeLocalDate(year, month, 1), end: makeLocalDate(year, month, daysInMonth(year, month)) };
  }
  if (mode === "quarterly") {
    const q = Math.floor((month - 1) / 3) + 1;
    const last = q * 3;
    return { key: `${year}-Q${q}`, start: makeLocalDate(year, last - 2, 1), end: makeLocalDate(year, last, daysInMonth(year, last)) };
  }
  return { key: String(year), start: makeLocalDate(year, 1, 1), end: makeLocalDate(year, 12, 31) };
}

/** A period is invoiced the day after it ends, in the business's time zone. */
export function periodClosed(period: BillingPeriod, today: LocalDate): boolean {
  return today > period.end;
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

/** FR-BIL-04, FR-BIL-08: how late an open invoice is, by days past its due date. */
export function agingBucket(due: LocalDate, today: LocalDate): AgingBucket {
  const late = daysBetween(due, today);
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}

export function dueDate(issued: LocalDate, termsDays: number): LocalDate {
  return addDays(issued, termsDays);
}
