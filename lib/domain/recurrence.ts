// Service plan recurrence (FR-SET-04, FR-SUB-01, FR-SUB-02).
//
// Rules are stored as standard RRULE strings without DTSTART (the
// subscription's start date supplies it), so exports stay portable. Only the
// subset operators actually sell is accepted, and expansion works on calendar
// dates, never instants, so daylight saving time cannot move a visit to
// another day (R-BUG-12).
//
// One deliberate difference from RFC 5545: a monthly or yearly visit on a day
// a month does not have (the 31st, or Feb 29) moves to that month's last day
// instead of silently disappearing. Customers on "the 31st" still get a visit
// in April.

import {
  addDays,
  dateParts,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  makeLocalDate,
  type LocalDate,
} from "./time";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface Rule {
  freq: Frequency;
  interval: number;
  /** WEEKLY: which weekdays. */
  byWeekday?: Weekday[];
  /** MONTHLY/YEARLY: "the 2nd Tuesday" (n = 1..4) or "the last Friday" (n = -1). */
  byNthWeekday?: { n: number; weekday: Weekday };
  /** Limit visits to these months (1-12), e.g. a lawn or mosquito season. */
  byMonth?: number[];
  /** MONTHLY/YEARLY: day of month, -1 for the last day. Defaults to the start date's day. */
  byMonthDay?: number;
}

export class RuleError extends Error {
  override name = "RuleError";
}

const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_OCCURRENCES = 2000;

export function parseRule(text: string): Rule {
  const source = text.trim().replace(/^RRULE:/i, "");
  if (!source) throw new RuleError("Recurrence is empty");

  const parts = new Map<string, string>();
  for (const piece of source.split(";")) {
    const [key, value, extra] = piece.split("=");
    if (!key || value === undefined || extra !== undefined || value === "") {
      throw new RuleError(`Cannot read "${piece}"`);
    }
    if (parts.has(key)) throw new RuleError(`${key} appears twice`);
    parts.set(key.toUpperCase(), value.toUpperCase());
  }

  const allowed = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTH", "BYMONTHDAY", "WKST"]);
  for (const key of parts.keys()) {
    if (!allowed.has(key)) throw new RuleError(`${key} is not supported for service plans`);
  }
  if ((parts.get("WKST") ?? "MO") !== "MO") throw new RuleError("Weeks start on Monday");

  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    throw new RuleError("FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY");
  }

  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    throw new RuleError("INTERVAL must be a whole number from 1 to 52");
  }

  const rule: Rule = { freq, interval };

  if (parts.has("BYMONTH")) {
    const months = parts.get("BYMONTH")!.split(",").map(Number);
    if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
      throw new RuleError("BYMONTH must list months 1 to 12");
    }
    rule.byMonth = [...new Set(months)].sort((a, b) => a - b);
  }

  if (parts.has("BYDAY")) {
    const days = parts.get("BYDAY")!.split(",");
    if (freq === "WEEKLY") {
      if (days.some((day) => !WEEKDAYS.includes(day as Weekday))) {
        throw new RuleError("BYDAY for weekly plans lists weekdays like MO,TH");
      }
      rule.byWeekday = sortWeekdays([...new Set(days as Weekday[])]);
    } else if (freq === "MONTHLY" || freq === "YEARLY") {
      const m = days.length === 1 ? /^([+-]?\d)(MO|TU|WE|TH|FR|SA|SU)$/.exec(days[0]!) : null;
      const n = m ? Number(m[1]) : NaN;
      if (!m || !(n === -1 || (n >= 1 && n <= 4))) {
        throw new RuleError("BYDAY for monthly plans is one weekday with a position, like 2TU or -1FR");
      }
      if (freq === "YEARLY" && !rule.byMonth) throw new RuleError("Yearly plans with BYDAY also need BYMONTH");
      rule.byNthWeekday = { n, weekday: m[2] as Weekday };
    } else {
      throw new RuleError("BYDAY is not supported for daily plans");
    }
  }

  if (parts.has("BYMONTHDAY")) {
    if (freq !== "MONTHLY" && freq !== "YEARLY") throw new RuleError("BYMONTHDAY needs a monthly or yearly plan");
    if (rule.byNthWeekday) throw new RuleError("Use BYDAY or BYMONTHDAY, not both");
    const day = Number(parts.get("BYMONTHDAY"));
    if (!Number.isInteger(day) || !(day === -1 || (day >= 1 && day <= 31))) {
      throw new RuleError("BYMONTHDAY must be 1 to 31, or -1 for the last day");
    }
    rule.byMonthDay = day;
  }

  return rule;
}

export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byWeekday?.length) parts.push(`BYDAY=${rule.byWeekday.join(",")}`);
  if (rule.byNthWeekday) parts.push(`BYDAY=${rule.byNthWeekday.n}${rule.byNthWeekday.weekday}`);
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  if (rule.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  return parts.join(";");
}

/** Throws RuleError with a readable message, or returns the canonical string. */
export function normalizeRule(text: string): string {
  return formatRule(parseRule(text));
}

/**
 * Every visit date from `start` onward that falls within [from, to].
 * `start` is the subscription's first service date and anchors the pattern.
 */
export function occurrences(ruleText: string | Rule, start: LocalDate, from: LocalDate, to: LocalDate): LocalDate[] {
  const rule = typeof ruleText === "string" ? parseRule(ruleText) : ruleText;
  const lower = from > start ? from : start;
  if (lower > to) return [];

  const out: LocalDate[] = [];
  const push = (date: LocalDate | null) => {
    if (date && date >= lower && date <= to && monthAllowed(rule, date)) out.push(date);
  };

  switch (rule.freq) {
    case "DAILY": {
      const skip = Math.max(0, Math.floor(daysBetween(start, lower) / rule.interval));
      for (let k = skip; ; k++) {
        const date = addDays(start, k * rule.interval);
        if (date > to) break;
        push(date);
        if (out.length > MAX_OCCURRENCES) break;
      }
      break;
    }
    case "WEEKLY": {
      const weekdays = rule.byWeekday ?? [WEEKDAYS[dayOfWeek(start)]!];
      const anchor = mondayOf(start);
      const skip = Math.max(0, Math.floor(daysBetween(anchor, mondayOf(lower)) / 7 / rule.interval));
      for (let k = skip; ; k++) {
        const monday = addDays(anchor, k * 7 * rule.interval);
        if (monday > to) break;
        for (const wd of weekdays) push(addDays(monday, mondayOffset(wd)));
        if (out.length > MAX_OCCURRENCES) break;
      }
      break;
    }
    case "MONTHLY": {
      const { year, month } = dateParts(start);
      const anchor = year * 12 + (month - 1);
      const { year: ly, month: lm } = dateParts(lower);
      const skip = Math.max(0, Math.floor((ly * 12 + (lm - 1) - anchor) / rule.interval) - 1);
      for (let k = skip; ; k++) {
        const index = anchor + k * rule.interval;
        const y = Math.floor(index / 12);
        const m = (index % 12) + 1;
        if (makeLocalDate(y, m, 1) > to) break;
        push(dayInMonth(rule, start, y, m));
        if (out.length > MAX_OCCURRENCES) break;
      }
      break;
    }
    case "YEARLY": {
      const { year } = dateParts(start);
      const { year: ly } = dateParts(lower);
      const months = rule.byMonth ?? [dateParts(start).month];
      const skip = Math.max(0, Math.floor((ly - year) / rule.interval) - 1);
      for (let k = skip; ; k++) {
        const y = year + k * rule.interval;
        if (makeLocalDate(y, 1, 1) > to) break;
        for (const m of months) push(dayInMonth(rule, start, y, m));
        if (out.length > MAX_OCCURRENCES) break;
      }
      break;
    }
  }

  return out.sort();
}

function monthAllowed(rule: Rule, date: LocalDate): boolean {
  return !rule.byMonth || rule.byMonth.includes(dateParts(date).month);
}

function dayInMonth(rule: Rule, start: LocalDate, year: number, month: number): LocalDate | null {
  const last = daysInMonth(year, month);
  if (rule.byNthWeekday) {
    const { n, weekday } = rule.byNthWeekday;
    const target = WEEKDAYS.indexOf(weekday);
    if (n > 0) {
      const firstDow = dayOfWeek(makeLocalDate(year, month, 1));
      const day = 1 + ((target - firstDow + 7) % 7) + (n - 1) * 7;
      return day <= last ? makeLocalDate(year, month, day) : null;
    }
    const lastDow = dayOfWeek(makeLocalDate(year, month, last));
    return makeLocalDate(year, month, last - ((lastDow - target + 7) % 7));
  }
  const wanted = rule.byMonthDay ?? dateParts(start).day;
  const day = wanted === -1 ? last : Math.min(wanted, last);
  return makeLocalDate(year, month, day);
}

function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

function mondayOffset(wd: Weekday): number {
  return (WEEKDAYS.indexOf(wd) + 6) % 7;
}

function sortWeekdays(days: Weekday[]): Weekday[] {
  return days.sort((a, b) => mondayOffset(a) - mondayOffset(b));
}

// Human-readable text (our own wording, used on plan and subscription screens).

const ORDINALS: Record<number, string> = { 1: "first", 2: "second", 3: "third", 4: "fourth", [-1]: "last" };

export function describeRule(ruleText: string | Rule, start?: LocalDate): string {
  const rule = typeof ruleText === "string" ? parseRule(ruleText) : ruleText;
  const every = (unit: string) => (rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`);
  let text: string;
  switch (rule.freq) {
    case "DAILY":
      text = every("day");
      break;
    case "WEEKLY": {
      const days = rule.byWeekday ?? (start ? [WEEKDAYS[dayOfWeek(start)]!] : []);
      text = every("week") + (days.length ? ` on ${listJoin(days.map((d) => WEEKDAY_NAMES[d]))}` : "");
      break;
    }
    case "MONTHLY":
      text = (rule.interval === 3 ? "Every 3 months (quarterly)" : every("month")) + monthDayText(rule, start);
      break;
    case "YEARLY":
      text = rule.byMonth
        ? `${rule.interval === 1 ? "Every year" : `Every ${rule.interval} years`} in ${listJoin(rule.byMonth.map((m) => MONTH_NAMES[m - 1]!))}${monthDayText(rule, start)}`
        : every("year");
      break;
  }
  if (rule.byMonth && rule.freq !== "YEARLY") text += `, ${seasonText(rule.byMonth)} only`;
  return text;
}

function monthDayText(rule: Rule, start?: LocalDate): string {
  if (rule.byNthWeekday) {
    return ` on the ${ORDINALS[rule.byNthWeekday.n]} ${WEEKDAY_NAMES[rule.byNthWeekday.weekday]}`;
  }
  const day = rule.byMonthDay ?? (start ? dateParts(start).day : undefined);
  if (day === undefined) return "";
  if (day === -1) return " on the last day";
  return ` on the ${ordinalDay(day)}${day > 28 ? " (or the month's last day)" : ""}`;
}

function seasonText(months: number[]): string {
  const contiguous = months.every((m, i) => i === 0 || m === months[i - 1]! + 1);
  if (contiguous && months.length > 2) return `${MONTH_NAMES[months[0]! - 1]} to ${MONTH_NAMES[months.at(-1)! - 1]}`;
  return listJoin(months.map((m) => MONTH_NAMES[m - 1]!));
}

function ordinalDay(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function listJoin(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Plans operators sell most; the plan form offers these before a custom rule. */
export const PLAN_PRESETS = [
  { id: "monthly", label: "Monthly", rrule: "FREQ=MONTHLY" },
  { id: "bimonthly", label: "Every 2 months", rrule: "FREQ=MONTHLY;INTERVAL=2" },
  { id: "quarterly", label: "Quarterly", rrule: "FREQ=MONTHLY;INTERVAL=3" },
  { id: "semiannual", label: "Twice a year", rrule: "FREQ=MONTHLY;INTERVAL=6" },
  { id: "annual", label: "Once a year", rrule: "FREQ=YEARLY" },
  { id: "every4weeks", label: "Every 4 weeks", rrule: "FREQ=WEEKLY;INTERVAL=4" },
  { id: "lawn6", label: "Lawn program, 6 rounds (Mar to Oct)", rrule: "FREQ=YEARLY;BYMONTH=3,4,5,7,9,10" },
  { id: "mosquito", label: "Every 3 weeks, May to September", rrule: "FREQ=WEEKLY;INTERVAL=3;BYMONTH=5,6,7,8,9" },
] as const;
