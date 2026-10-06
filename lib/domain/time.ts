// Calendar dates, wall-clock times and IANA zones (ENG-05, R-BUG-12).
//
// What a person schedules is a local date plus a local time in a named zone.
// Instants (Date) appear only at the edges: reminders, "completed at", logs.
// Nothing here stores or accepts a UTC offset.

declare const localDateBrand: unique symbol;
declare const localTimeBrand: unique symbol;

/** A calendar date with no zone, e.g. "2026-10-14". */
export type LocalDate = string & { readonly [localDateBrand]: true };
/** A wall-clock time with no zone, "HH:MM" in 24-hour form, e.g. "08:30". */
export type LocalTime = string & { readonly [localTimeBrand]: true };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

export function isLocalDate(value: string): value is LocalDate {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseLocalDate(value: string): LocalDate {
  if (!isLocalDate(value)) throw new RangeError(`Not a calendar date: ${value}`);
  return value;
}

export function isLocalTime(value: string): value is LocalTime {
  return TIME_RE.test(value);
}

export function parseLocalTime(value: string): LocalTime {
  // Postgres returns time columns as "HH:MM:SS"; accept and drop the seconds.
  const trimmed = /^\d{2}:\d{2}:\d{2}$/.test(value) ? value.slice(0, 5) : value;
  if (!isLocalTime(trimmed)) throw new RangeError(`Not a wall-clock time: ${value}`);
  return trimmed;
}

export function makeLocalDate(year: number, month: number, day: number): LocalDate {
  return parseLocalDate(`${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`);
}

export function dateParts(date: LocalDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date)!;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtcMs(date: LocalDate): number {
  const { year, month, day } = dateParts(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): LocalDate {
  const d = new Date(ms);
  return makeLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Calendar months later; the day is clamped to the target month (Jan 31 + 1 month = Feb 28). */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = dateParts(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return makeLocalDate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(...dates: LocalDate[]): LocalDate {
  return dates.reduce((a, b) => (a > b ? a : b));
}

// Zones -------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Region-qualified IANA names only (America/Denver) plus UTC; mirrors app.iana_zones. */
const ZONE_RE = /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+(\/[A-Za-z_+-]+)?$/;

export function isIanaZone(value: string): boolean {
  if (value !== "UTC" && !ZONE_RE.test(value)) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

function wallClockMs(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Minutes to add to UTC to get wall-clock time in the zone at that instant. */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const ms = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallClockMs(ms, timeZone) - ms) / 60_000);
}

/**
 * The instant at which a wall-clock time happens in a zone.
 *
 * - Times skipped by a spring-forward change (02:30 on the second Sunday of
 *   March in Denver) move forward by the size of the gap (03:30 MDT).
 * - Times that happen twice when clocks fall back resolve to the first one.
 */
export function zonedTimeToInstant(date: LocalDate, time: LocalTime, timeZone: string): Date {
  const { year, month, day } = dateParts(date);
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hh, mm);

  // Offsets a day either side are the zone's offsets before and after any
  // transition near this wall time (real transitions are months apart).
  const before = zoneOffsetMinutes(timeZone, new Date(wall - DAY_MS));
  const after = zoneOffsetMinutes(timeZone, new Date(wall + DAY_MS));
  const candidates = [...new Set([wall - before * 60_000, wall - after * 60_000])]
    .filter((c) => wallClockMs(c, timeZone) === wall)
    .sort((a, b) => a - b);

  if (candidates.length > 0) return new Date(candidates[0]!);
  return new Date(wall - before * 60_000);
}

export function instantToZoned(instant: Date, timeZone: string): { date: LocalDate; time: LocalTime } {
  const wall = new Date(wallClockMs(instant.getTime(), timeZone));
  return {
    date: makeLocalDate(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate()),
    time: parseLocalTime(`${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`),
  };
}

export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  return instantToZoned(now, timeZone).date;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
