import { toCsv, type Cell } from "@/lib/csv";
import { addDays, compareDates, dateParts, daysBetween, instantToZoned, isLocalDate, makeLocalDate, type LocalDate } from "@/lib/domain/time";
import { amountLabel, areaLabel, formatNumber, isAmountUnit, isAreaUnit, isMixUnit, mixLabel } from "@/lib/domain/units";
import { SIGNAL_WORD } from "@/lib/ui/format";

// FR-REC-06: product usage by date range, product, EPA number and technician,
// read from the application records as they were saved (the CR-01 snapshot on
// each record, not today's catalog). An amended record counts once, in its
// amended form (FR-REC-03). Shared by the screen, the CSV and the PDF.

/** One request covers at most a year, which keeps the PDF and the query bounded. */
export const MAX_RANGE_DAYS = 366;
/** Rows listed on screen; the CSV and PDF carry more. */
export const SCREEN_ROWS = 500;
export const PDF_ROWS = 5_000;
export const CSV_ROWS = 100_000;

export interface UsageFilters {
  from: LocalDate;
  to: LocalDate;
  productId: string | null;
  technicianId: string | null;
}

export interface UsageRow {
  id: string;
  appointmentId: string | null;
  appliedAt: Date;
  applicatorName: string | null;
  applicatorLicenseNo: string | null;
  customerName: string | null;
  applicationAddress: string | null;
  productName: string;
  productKind: string | null;
  epaRegNo: string | null;
  signalWord: string | null;
  restrictedUse: boolean;
  mixRate: number | null;
  mixUnit: string | null;
  totalAmount: number | null;
  amountUnit: string | null;
  areaTreated: number | null;
  areaUnit: string | null;
  targetSites: string[];
  targetPests: string[];
  customerStatementAt: Date | null;
  /** This row corrects an earlier record. */
  amendment: boolean;
}

/**
 * Per product as recorded (name and EPA number), with the amount applied per
 * unit: units are summed as entered, never converted. The unit used most
 * often comes first.
 */
export interface UsageTotal {
  productName: string;
  epaRegNo: string | null;
  restrictedUse: boolean;
  applications: number;
  amounts: { unit: string | null; total: number; applications: number }[];
}

export interface UsageReport {
  filters: UsageFilters;
  timeZone: string;
  business: { name: string; licenseNo: string; address: string };
  /** Names for the filters in use, for headings and file names. */
  productLabel: string | null;
  technicianLabel: string | null;
  totals: UsageTotal[];
  /** Every matching record; `rows` may hold fewer. */
  count: number;
  rows: UsageRow[];
  truncated: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The filters from a query string. Missing dates mean this month so far; a
 * reversed range is swapped; a range longer than a year is cut to the year
 * ending on its last day, and `problem` says so.
 */
export function parseUsageFilters(params: { from?: string; to?: string; product?: string; technician?: string }, today: LocalDate): { filters: UsageFilters; problem: string | null } {
  const { year, month } = dateParts(today);
  let problem: string | null = null;
  const read = (value: string | undefined, fallback: LocalDate) => {
    if (!value) return fallback;
    if (isLocalDate(value)) return value;
    problem = "One of the dates could not be read, so this month so far is shown.";
    return null;
  };
  let from = read(params.from, makeLocalDate(year, month, 1));
  let to = read(params.to, today);
  if (!from || !to) {
    from = makeLocalDate(year, month, 1);
    to = today;
  }
  if (compareDates(from, to) > 0) [from, to] = [to, from];
  if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
    problem = "A report covers at most a year, so it starts a year before the end date.";
  }
  return {
    filters: {
      from,
      to,
      productId: params.product && UUID.test(params.product) ? params.product : null,
      technicianId: params.technician && UUID.test(params.technician) ? params.technician : null,
    },
    problem,
  };
}

/** The query string for these filters, for links to the same report as CSV or PDF. */
export function usageQuery(filters: UsageFilters, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    from: filters.from,
    to: filters.to,
    ...(filters.productId ? { product: filters.productId } : {}),
    ...(filters.technicianId ? { technician: filters.technicianId } : {}),
    ...extra,
  }).toString();
}

export function amountText(value: number | null, unit: string | null): string {
  if (value === null) return "";
  return unit && isAmountUnit(unit) ? `${formatNumber(value)} ${amountLabel(unit)}` : formatNumber(value);
}

export function areaText(value: number | null, unit: string | null): string {
  if (value === null) return "";
  return unit && isAreaUnit(unit) ? `${formatNumber(value)} ${areaLabel(unit)}` : formatNumber(value);
}

export function mixText(value: number | null, unit: string | null): string {
  if (value === null) return "";
  return unit && isMixUnit(unit) ? `${formatNumber(value)} ${mixLabel(unit)}` : formatNumber(value);
}

/** "12.5 gal, 64 fl oz" */
export function totalText(total: UsageTotal): string {
  return total.amounts.map((a) => amountText(a.total, a.unit)).join(", ");
}

/** For a file name: product-usage-2026-10-01-to-2026-10-07 */
export function usageFileName(filters: UsageFilters, ext: "csv" | "pdf"): string {
  return `product-usage-${filters.from}-to-${filters.to}.${ext}`;
}

function local(instant: Date, timeZone: string): { date: string; time: string } {
  return instantToZoned(instant, timeZone);
}

/** One line per record with every CR-01 field, in the business's own time zone (ENG-05). */
export function usageCsv(report: UsageReport): string {
  const tz = report.timeZone;
  const header: Cell[] = [
    "Applied date", "Applied time", "Time zone", "Applicator", "Applicator license", "Customer", "Application address", "Product",
    "EPA registration no.", "Signal word", "Restricted use", "Mix rate", "Mix unit", "Total applied", "Amount unit", "Area treated",
    "Area unit", "Target sites", "Target pests", "Customer statement given", "Amendment", "Record id",
  ];
  const rows = report.rows.map((r): Cell[] => {
    const at = local(r.appliedAt, tz);
    const statement = r.customerStatementAt ? local(r.customerStatementAt, tz) : null;
    return [
      at.date, at.time, tz, r.applicatorName, r.applicatorLicenseNo, r.customerName, r.applicationAddress, r.productName,
      r.epaRegNo ?? (r.productKind === "minimum_risk" ? "Exempt, FIFRA 25(b)" : null), r.signalWord ? (SIGNAL_WORD[r.signalWord] ?? r.signalWord) : null,
      r.restrictedUse ? "Yes" : "No", r.mixRate, r.mixUnit && isMixUnit(r.mixUnit) ? mixLabel(r.mixUnit) : r.mixUnit, r.totalAmount,
      r.amountUnit && isAmountUnit(r.amountUnit) ? amountLabel(r.amountUnit) : r.amountUnit, r.areaTreated,
      r.areaUnit && isAreaUnit(r.areaUnit) ? areaLabel(r.areaUnit) : r.areaUnit, r.targetSites.join("; "), r.targetPests.join("; "),
      statement ? `${statement.date} ${statement.time}` : null, r.amendment ? "Yes" : "No", r.id,
    ];
  });
  return toCsv([header, ...rows]);
}
