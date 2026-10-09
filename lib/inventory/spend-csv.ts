import { toCsv, type Cell } from "@/lib/csv";
import type { ServiceCost, SpendMonth } from "@/lib/server/inventory";

// FR-INV-09: the spend report as a CSV, dollars as text, one row per month and vendor.
const dollars = (cents: number) => (cents / 100).toFixed(2);

export function spendCsv(months: readonly SpendMonth[], costs: readonly ServiceCost[]): string {
  const rows: Cell[][] = [["Month", "Vendor", "Received spend"]];
  for (const m of months) for (const v of m.vendors) rows.push([m.month, v.name, dollars(v.cents)]);
  rows.push([], ["Service type", "Completed visits in window", "Material cost per visit"]);
  for (const c of costs) rows.push([c.name, c.visits, dollars(c.centsPerVisit)]);
  return toCsv(rows);
}
