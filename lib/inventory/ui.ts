import { formatNumber, formatQuantity, type AmountUnit } from "@/lib/domain/units";
import type { Bucket } from "@/lib/domain/inventory";
import { formatLocalDate } from "@/lib/ui/format";

// FR-INV: display helpers shared by the inventory pages.

/** Monday first, the way a week reads on the schedule; the value is the 0 = Sunday number the database stores. */
export const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
] as const;

export function weekdayName(day: number): string {
  return WEEKDAYS.find((d) => d.value === day)?.label ?? "";
}

/** A quantity with its unit; a bare number when the product has no usable unit yet. */
export function qtyText(value: number, unit: AmountUnit | null): string {
  return unit ? formatQuantity({ value, unit }) : formatNumber(value);
}

export const BUCKET_LABEL: Record<Bucket["key"], string> = {
  week0: "This week",
  week1: "Next week",
  week2: "In 2 weeks",
  week3: "In 3 weeks",
  month: "Rest of month",
};

/** Plain range for a forecast column, e.g. "Oct 12 to Oct 18". */
export function rangeText(from: string, to: string): string {
  return from === to ? formatLocalDate(from, "short") : `${formatLocalDate(from, "short")} to ${formatLocalDate(to, "short")}`;
}


/** FR-INV-05: order status labels and badge tones. */
export const ORDER_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "accent" },
  received: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};
