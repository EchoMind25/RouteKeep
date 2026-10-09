// Inventory math (FR-INV-02, FR-INV-03, FR-INV-05, FR-INV-06, FR-INV-07, FR-INV-10, FR-INV-11).
//
// Pure functions, no IO. The server layer (lib/server/inventory.ts) loads rows,
// these turn them into numbers. Dates are LocalDate strings in the business's
// zone (ENG-05); weeks run Monday to Sunday. See docs/INVENTORY.md.

import { isAmountUnit, isMixUnit, mixBasis, mixProductUnit, productNeeded, convert, UnitError, type AmountUnit } from "./units";
import { addDays, dayOfWeek, daysBetween, daysInMonth, makeLocalDate, dateParts, type LocalDate } from "./time";

// Product used ---------------------------------------------------------------------------

export interface ApplicationAmounts {
  mixRate: number | null;
  mixUnit: string | null;
  totalAmount: number | null;
  amountUnit: string | null;
}

/**
 * FR-INV-02: product taken out of stock by one application, in `stockUnit`.
 * `total_amount` is finished mix for solution rates (so it is turned back into
 * concentrate) and the product itself for area rates. Missing data or a
 * volume/mass mismatch is null, never zero: the record is listed to check.
 */
export function productUsed(app: ApplicationAmounts, stockUnit: AmountUnit): number | null {
  const { mixRate, mixUnit, totalAmount, amountUnit } = app;
  if (mixRate === null || mixUnit === null || totalAmount === null || amountUnit === null) return null;
  if (!isMixUnit(mixUnit) || !isAmountUnit(amountUnit) || !(totalAmount >= 0) || !Number.isFinite(totalAmount)) return null;
  try {
    const amount = { value: totalAmount, unit: amountUnit };
    const product = mixBasis(mixUnit) === "solution" ? productNeeded({ rate: mixRate, unit: mixUnit }, { finishedMix: amount }) : amount;
    return convert(product, stockUnit).value;
  } catch (e) {
    if (e instanceof UnitError) return null;
    throw e;
  }
}

/** The unit a product's stock is kept in: its setting, else its default mix's product unit, else its default amount unit. */
export function stockUnitFor(product: { stockUnit: string | null; defaultMixUnit: string | null; defaultAmountUnit: string | null }): AmountUnit | null {
  if (product.stockUnit && isAmountUnit(product.stockUnit)) return product.stockUnit;
  if (product.defaultMixUnit && isMixUnit(product.defaultMixUnit)) return mixProductUnit(product.defaultMixUnit);
  if (product.defaultAmountUnit && isAmountUnit(product.defaultAmountUnit)) return product.defaultAmountUnit;
  return null;
}

/** Sum of quantities in `unit`, null when any entry cannot be converted (so nothing is silently dropped). */
export function convertQty(qty: number, from: AmountUnit, to: AmountUnit): number | null {
  try {
    return convert({ value: qty, unit: from }, to).value;
  } catch (e) {
    if (e instanceof UnitError) return null;
    throw e;
  }
}

// On hand ---------------------------------------------------------------------------------

export type MovementKind = "count" | "receive" | "transfer_in" | "transfer_out" | "adjust";

export interface StockMove {
  kind: MovementKind;
  qty: number;
  unit: AmountUnit;
  at: Date;
}
/** Product used by the location's technician, already in the stock unit (productUsed). */
export interface StockUse {
  qty: number;
  at: Date;
}
export interface OnHand {
  qty: number;
  /** When the baseline count was taken; null when the pair was never counted (baseline 0). */
  countedAt: Date | null;
  /** Movements that could not be converted to the stock unit and were left out. */
  skipped: number;
}

/**
 * FR-INV-06: latest count as the baseline, then receipts, transfers and
 * adjustments, minus usage, all after it. `asOf` (exclusive) gives the
 * expected quantity at an instant, which a count stores as expected_qty (FR-INV-07).
 */
export function onHand(moves: readonly StockMove[], uses: readonly StockUse[], stockUnit: AmountUnit, asOf?: Date): OnHand {
  const cutoff = asOf?.getTime() ?? Infinity;
  const live = moves.filter((m) => m.at.getTime() < cutoff);
  let base: StockMove | null = null;
  for (const m of live) if (m.kind === "count" && (!base || m.at.getTime() >= base.at.getTime())) base = m;
  const from = base ? base.at.getTime() : -Infinity;
  let qty = 0;
  let skipped = 0;
  if (base) {
    const q = convertQty(base.qty, base.unit, stockUnit);
    if (q === null) skipped++;
    else qty = q;
  }
  for (const m of live) {
    if (m.kind === "count" || m.at.getTime() <= from) continue;
    const q = convertQty(m.qty, m.unit, stockUnit);
    if (q === null) skipped++;
    else qty += q;
  }
  for (const u of uses) if (u.at.getTime() > from && u.at.getTime() < cutoff) qty -= u.qty;
  return { qty: roundQty(qty), countedAt: base?.at ?? null, skipped };
}

/** Six decimals, matching numeric(14,6), so float noise never shows as variance. */
export function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// Weeks -------------------------------------------------------------------------------------

/** The Monday on or before the date. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}
export function weekEnd(date: LocalDate): LocalDate {
  return addDays(weekStart(date), 6);
}
export function monthEnd(date: LocalDate): LocalDate {
  const { year, month } = dateParts(date);
  return makeLocalDate(year, month, daysInMonth(year, month));
}

// Usage rates ------------------------------------------------------------------------------

/** FR-INV-03: below this many completed visits a window is too thin to forecast from. */
export const MIN_RATE_VISITS = 10;
export const SHORT_WINDOW_WEEKS = 8;
export const LONG_WINDOW_WEEKS = 26;

export interface CompletedVisit {
  localDate: LocalDate;
  serviceTypeId: string;
  /** Visits sharing the same date and type, when the caller grouped them. */
  count?: number;
}
export interface UseRecord {
  localDate: LocalDate;
  serviceTypeId: string;
  productId: string;
  /** Product used in the stock unit. */
  qty: number;
}
export interface TypeBasis {
  serviceTypeId: string;
  /** The window the rate comes from; 26 also when neither window had enough visits. */
  windowWeeks: 8 | 26;
  visits: number;
  /** False: fewer than 10 visits even over 26 weeks, so no rate. */
  enough: boolean;
}
export interface UsageRate {
  serviceTypeId: string;
  productId: string;
  perVisit: number;
  basis: TypeBasis;
}

/** The inclusive first day of a trailing window of whole days ending `today`. */
function windowStart(today: LocalDate, weeks: number): LocalDate {
  return addDays(today, -(weeks * 7 - 1));
}

/** FR-INV-03: product per completed visit, by service type and product; 8 weeks, else 26, else none. */
export function usageRates(visits: readonly CompletedVisit[], uses: readonly UseRecord[], today: LocalDate): { bases: TypeBasis[]; rates: UsageRate[] } {
  const start8 = windowStart(today, SHORT_WINDOW_WEEKS);
  const start26 = windowStart(today, LONG_WINDOW_WEEKS);
  const count = (typeId: string, from: LocalDate) =>
    visits.reduce((n, v) => (v.serviceTypeId === typeId && v.localDate >= from && v.localDate <= today ? n + (v.count ?? 1) : n), 0);
  const typeIds = [...new Set(visits.map((v) => v.serviceTypeId))].sort();
  const bases: TypeBasis[] = typeIds.map((serviceTypeId) => {
    const v8 = count(serviceTypeId, start8);
    if (v8 >= MIN_RATE_VISITS) return { serviceTypeId, windowWeeks: 8, visits: v8, enough: true };
    const v26 = count(serviceTypeId, start26);
    return { serviceTypeId, windowWeeks: 26, visits: v26, enough: v26 >= MIN_RATE_VISITS };
  });
  const rates: UsageRate[] = [];
  for (const basis of bases) {
    if (!basis.enough) continue;
    const from = basis.windowWeeks === 8 ? start8 : start26;
    const totals = new Map<string, number>();
    for (const u of uses) {
      if (u.serviceTypeId !== basis.serviceTypeId || u.localDate < from || u.localDate > today) continue;
      totals.set(u.productId, (totals.get(u.productId) ?? 0) + u.qty);
    }
    for (const [productId, total] of [...totals].sort((a, b) => a[0].localeCompare(b[0]))) {
      rates.push({ serviceTypeId: basis.serviceTypeId, productId, perVisit: total / basis.visits, basis });
    }
  }
  return { bases, rates };
}

// Forecast ---------------------------------------------------------------------------------

export interface ScheduledGroup {
  localDate: LocalDate;
  serviceTypeId: string;
  technicianId: string | null;
  visits: number;
}
export interface ForecastRow {
  localDate: LocalDate;
  productId: string;
  technicianId: string | null;
  qty: number;
}

/** FR-INV-03: expected product on each day, from scheduled visits times the per-visit rate. Visits of a type with no rate are counted apart. */
export function forecastByDay(groups: readonly ScheduledGroup[], rates: readonly UsageRate[]): { rows: ForecastRow[]; unforecastVisits: number } {
  const byType = new Map<string, UsageRate[]>();
  for (const r of rates) byType.set(r.serviceTypeId, [...(byType.get(r.serviceTypeId) ?? []), r]);
  const rows = new Map<string, ForecastRow>();
  let unforecastVisits = 0;
  for (const g of groups) {
    const typeRates = byType.get(g.serviceTypeId);
    if (!typeRates) {
      unforecastVisits += g.visits;
      continue;
    }
    for (const r of typeRates) {
      const key = `${g.localDate}|${r.productId}|${g.technicianId ?? ""}`;
      const row = rows.get(key) ?? { localDate: g.localDate, productId: r.productId, technicianId: g.technicianId, qty: 0 };
      row.qty += r.perVisit * g.visits;
      rows.set(key, row);
    }
  }
  return { rows: [...rows.values()].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.productId.localeCompare(b.productId)), unforecastVisits };
}

export interface Bucket {
  key: "week0" | "week1" | "week2" | "week3" | "month";
  from: LocalDate;
  to: LocalDate;
}

/**
 * FR-INV-03: this week from today, the next three Monday to Sunday weeks, and
 * the rest of the calendar month from today (a running total that overlaps the weeks).
 */
export function forecastBuckets(today: LocalDate): Bucket[] {
  const w0 = weekStart(today);
  const bucket = (key: Bucket["key"], from: LocalDate, to: LocalDate): Bucket => ({ key, from, to });
  return [
    bucket("week0", today, addDays(w0, 6)),
    bucket("week1", addDays(w0, 7), addDays(w0, 13)),
    bucket("week2", addDays(w0, 14), addDays(w0, 20)),
    bucket("week3", addDays(w0, 21), addDays(w0, 27)),
    bucket("month", today, monthEnd(today)),
  ];
}

/** Forecast quantity per product per bucket (same order as `buckets`). */
export function bucketForecast(rows: readonly ForecastRow[], buckets: readonly Bucket[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const sums = out.get(r.productId) ?? buckets.map(() => 0);
    buckets.forEach((b, i) => {
      if (r.localDate >= b.from && r.localDate <= b.to) sums[i]! += r.qty;
    });
    out.set(r.productId, sums);
  }
  return out;
}

/** Sum of forecast quantity for dates in [from, to] (inclusive; empty when to < from). */
export function forecastBetween(rows: readonly { localDate: LocalDate; qty: number }[], from: LocalDate, to: LocalDate): number {
  let total = 0;
  for (const r of rows) if (r.localDate >= from && r.localDate <= to) total += r.qty;
  return total;
}

// Weekly averages --------------------------------------------------------------------------

export interface WeeklyAverages {
  lastWeek: number;
  avg4: number;
  avg8: number;
  avg12: number;
}

/** FR-INV-02: last full week (Monday to Sunday before the current week) and trailing 4, 8 and 12 full-week averages. */
export function weeklyAverages(uses: readonly { localDate: LocalDate; qty: number }[], today: LocalDate): WeeklyAverages {
  const lastEnd = addDays(weekStart(today), -1);
  const week = (n: number) => {
    const to = addDays(lastEnd, -7 * n);
    return forecastBetween(uses, addDays(to, -6), to);
  };
  const avg = (n: number) => {
    let total = 0;
    for (let i = 0; i < n; i++) total += week(i);
    return total / n;
  };
  return { lastWeek: week(0), avg4: avg(4), avg8: avg(8), avg12: avg(12) };
}

// Resupply ---------------------------------------------------------------------------------

/** The first date on or after `from` that falls on one of the weekdays (0 = Sunday); `from` itself when none are set. */
export function nextOrderDate(from: LocalDate, weekdays: readonly number[]): LocalDate {
  if (weekdays.length === 0) return from;
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (weekdays.includes(dayOfWeek(d))) return d;
  }
  return from;
}

/** The first date strictly after `from` on the weekday (FR-INV-08: the next resupply day). */
export function nextWeekdayAfter(from: LocalDate, weekday: number): LocalDate {
  return nextOrderDate(addDays(from, 1), [weekday]);
}

export interface SuggestInput {
  mode: "forecast" | "tracked";
  today: LocalDate;
  orderWeekdays: readonly number[];
  leadTimeDays: number;
  /** Package size in the product's stock unit. */
  packageQty: number;
  safetyDays: number;
  /** Forecast for this product, all technicians. */
  forecast: readonly { localDate: LocalDate; qty: number }[];
  /** Tracked mode: on hand in every location, and open (sent, not received) order quantity. */
  onHand?: number;
  openOrderQty?: number;
}
export interface Suggestion {
  orderDate: LocalDate;
  arrivalDate: LocalDate;
  /** Last day the order must cover (the day before the following order would arrive). */
  coverEnd: LocalDate;
  need: number;
  packages: number;
  /** Tracked mode: when to order so stock never falls below safety stock; null when it never does in the horizon. */
  orderBy: LocalDate | null;
  /** True when that date has already passed (order today). */
  late: boolean;
}

const HORIZON_DAYS = 120;

/** FR-INV-05: how much to order, and by when, for one product. */
export function suggestResupply(i: SuggestInput): Suggestion {
  const orderDate = nextOrderDate(i.today, i.orderWeekdays);
  const arrivalDate = addDays(orderDate, i.leadTimeDays);
  const coverEnd =
    i.orderWeekdays.length === 0
      ? addDays(arrivalDate, 6)
      : addDays(addDays(nextOrderDate(addDays(orderDate, 1), i.orderWeekdays), i.leadTimeDays), -1);
  const ceilPackages = (n: number) => (n <= 1e-9 ? 0 : Math.ceil(n / i.packageQty - 1e-9));

  if (i.mode === "forecast") {
    const need = forecastBetween(i.forecast, i.today, coverEnd);
    return { orderDate, arrivalDate, coverEnd, need, packages: ceilPackages(need), orderBy: null, late: false };
  }

  const have = (i.onHand ?? 0) + (i.openOrderQty ?? 0);
  const avgDaily = forecastBetween(i.forecast, i.today, addDays(i.today, 27)) / 28;
  const safetyStock = i.safetyDays * avgDaily;
  const projected = have - forecastBetween(i.forecast, i.today, addDays(arrivalDate, -1));
  const need = forecastBetween(i.forecast, arrivalDate, coverEnd) + safetyStock - projected;

  let orderBy: LocalDate | null = null;
  let stock = have;
  for (let d = 0; d < HORIZON_DAYS; d++) {
    const day = addDays(i.today, d);
    stock -= forecastBetween(i.forecast, day, day);
    if (stock < safetyStock) {
      orderBy = addDays(day, -i.leadTimeDays);
      break;
    }
  }
  const late = orderBy !== null && orderBy < i.today;
  return { orderDate, arrivalDate, coverEnd, need, packages: ceilPackages(Math.max(need, 0)), orderBy: late ? i.today : orderBy, late };
}

/** FR-INV-05: vendors under their minimum are flagged, never padded. */
export function orderTotal(lines: readonly { packages: number; priceCents: number | null }[], minOrderCents: number | null): { totalCents: number; unpriced: boolean; belowMinimum: boolean } {
  let totalCents = 0;
  let unpriced = false;
  for (const l of lines) {
    if (l.priceCents === null) unpriced = true;
    else totalCents += l.packages * l.priceCents;
  }
  return { totalCents, unpriced, belowMinimum: minOrderCents !== null && !unpriced && totalCents < minOrderCents };
}

// Outliers ---------------------------------------------------------------------------------

export const OUTLIER_HIGH = 1.5;
export const OUTLIER_LOW = 0.5;

export interface TechUsage {
  technicianId: string;
  serviceTypeId: string;
  productId: string;
  /** Completed visits of that type by that technician in the window. */
  visits: number;
  qty: number;
}
export interface Outlier {
  technicianId: string;
  serviceTypeId: string;
  productId: string;
  perVisit: number;
  median: number;
  ratio: number;
  direction: "high" | "low";
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * FR-INV-11: usage per visit above 1.5x or below 0.5x the business median for
 * the same service type and product. Only technicians with at least 10 visits
 * count, and at least two are needed to have a median worth comparing to.
 */
export function usageOutliers(rows: readonly TechUsage[], minVisits = MIN_RATE_VISITS): Outlier[] {
  const groups = new Map<string, TechUsage[]>();
  for (const r of rows) {
    if (r.visits < minVisits) continue;
    const key = `${r.serviceTypeId}|${r.productId}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Outlier[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const mid = median(group.map((g) => g.qty / g.visits));
    if (!(mid > 0)) continue;
    for (const g of group) {
      const perVisit = g.qty / g.visits;
      const ratio = perVisit / mid;
      if (ratio > OUTLIER_HIGH || ratio < OUTLIER_LOW) {
        out.push({ technicianId: g.technicianId, serviceTypeId: g.serviceTypeId, productId: g.productId, perVisit, median: mid, ratio, direction: ratio > 1 ? "high" : "low" });
      }
    }
  }
  return out.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
}

// Pests ------------------------------------------------------------------------------------

// Canonical names match the chips in components/tech/application-editor.tsx.
const PEST_SYNONYMS: Record<string, string> = {
  ant: "Ants", ants: "Ants", "pavement ants": "Ants", "pavement ant": "Ants", "carpenter ants": "Ants", "carpenter ant": "Ants",
  "odorous house ants": "Ants", "odorous ants": "Ants", "fire ants": "Ants", "sugar ants": "Ants",
  spider: "Spiders", spiders: "Spiders", "black widow": "Spiders", "black widows": "Spiders", "hobo spiders": "Spiders",
  wasp: "Wasps", wasps: "Wasps", "paper wasps": "Wasps", "yellow jackets": "Wasps", "yellowjackets": "Wasps", hornets: "Wasps",
  earwig: "Earwigs", earwigs: "Earwigs",
  cricket: "Crickets", crickets: "Crickets",
  roach: "Cockroaches", roaches: "Cockroaches", cockroach: "Cockroaches", cockroaches: "Cockroaches",
  "german roaches": "Cockroaches", "german roach": "Cockroaches", "german cockroaches": "Cockroaches", "american roaches": "Cockroaches",
  mouse: "Mice", mice: "Mice",
  rat: "Rats", rats: "Rats",
  mosquito: "Mosquitoes", mosquitoes: "Mosquitoes", mosquitos: "Mosquitoes",
  weeds: "Broadleaf weeds", weed: "Broadleaf weeds", "broadleaf weeds": "Broadleaf weeds", broadleaf: "Broadleaf weeds",
  grub: "Grubs", grubs: "Grubs", "white grubs": "Grubs",
  aphid: "Aphids", aphids: "Aphids",
};

/** FR-INV-10: one name per pest: trimmed, case-folded, common synonyms merged; null when empty. */
export function normalizePest(raw: string): string | null {
  const key = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return null;
  return PEST_SYNONYMS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export interface PestSighting {
  zip: string;
  pest: string;
  localDate: LocalDate;
  /** A visit counts once per pest however many products were applied. */
  appointmentId: string;
}
export interface PestTrend {
  zip: string;
  pest: string;
  /** Visits per Monday to Sunday week, oldest first, ending with the current week. */
  weekly: number[];
  recent4: number;
  prior4: number;
  rising: boolean;
}

/** Rising: the last 4 full weeks are up at least 50% on the 4 before, which had at least 5 visits. */
export const RISING_UP = 1.5;
export const RISING_MIN_VISITS = 5;

/** FR-INV-10: target pests by ZIP and week for this business, with rising flags. `weeks` includes the current week and is at least 9. */
export function pestTrend(sightings: readonly PestSighting[], today: LocalDate, weeks = 12): PestTrend[] {
  const n = Math.max(9, weeks);
  const current = weekStart(today);
  const first = addDays(current, -7 * (n - 1));
  const seen = new Set<string>();
  const series = new Map<string, { zip: string; pest: string; weekly: number[] }>();
  for (const s of sightings) {
    const pest = normalizePest(s.pest);
    if (!pest || s.localDate < first || s.localDate > addDays(current, 6)) continue;
    const dedupe = `${s.appointmentId}|${s.zip}|${pest}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = `${s.zip}|${pest}`;
    const row = series.get(key) ?? { zip: s.zip, pest, weekly: Array<number>(n).fill(0) };
    row.weekly[Math.floor(daysBetween(first, weekStart(s.localDate)) / 7)]! += 1;
    series.set(key, row);
  }
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return [...series.values()]
    .map((row) => {
      // The current week is partial, so trends compare the full weeks before it.
      const full = row.weekly.slice(0, -1);
      const recent4 = sum(full.slice(-4));
      const prior4 = sum(full.slice(-8, -4));
      return { ...row, recent4, prior4, rising: prior4 >= RISING_MIN_VISITS && recent4 >= prior4 * RISING_UP };
    })
    .sort((a, b) => Number(b.rising) - Number(a.rising) || b.recent4 - a.recent4 || a.zip.localeCompare(b.zip) || a.pest.localeCompare(b.pest));
}
