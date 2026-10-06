import fc from "fast-check";
import rrulePkg from "rrule";
import { describe, expect, it } from "vitest";
import { describeRule, formatRule, normalizeRule, occurrences, parseRule, RuleError, type Rule, type Weekday } from "./recurrence";
import { addDays, makeLocalDate, parseLocalDate as d, zonedTimeToInstant, parseLocalTime as t, type LocalDate } from "./time";

const { RRule } = rrulePkg;

describe("parseRule", () => {
  it("accepts the plans operators sell and canonicalises them", () => {
    expect(normalizeRule("RRULE:FREQ=MONTHLY;INTERVAL=3")).toBe("FREQ=MONTHLY;INTERVAL=3");
    expect(normalizeRule("freq=weekly;byday=th,mo")).toBe("FREQ=WEEKLY;BYDAY=MO,TH");
    expect(normalizeRule("FREQ=YEARLY;BYMONTH=10,3,5")).toBe("FREQ=YEARLY;BYMONTH=3,5,10");
    expect(normalizeRule("FREQ=MONTHLY;BYDAY=-1FR")).toBe("FREQ=MONTHLY;BYDAY=-1FR");
  });

  it.each([
    ["", "empty"],
    ["FREQ=HOURLY", "FREQ must be"],
    ["FREQ=MONTHLY;COUNT=4", "COUNT is not supported"],
    ["FREQ=MONTHLY;UNTIL=20270101", "UNTIL is not supported"],
    ["FREQ=MONTHLY;INTERVAL=0", "INTERVAL"],
    ["FREQ=WEEKLY;BYDAY=2TU", "weekdays like MO,TH"],
    ["FREQ=MONTHLY;BYDAY=5TU", "with a position"],
    ["FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=3", "not both"],
    ["FREQ=MONTHLY;BYMONTH=13", "months 1 to 12"],
    ["FREQ=MONTHLY;FREQ=WEEKLY", "twice"],
    ["FREQ=WEEKLY;WKST=SU", "Monday"],
  ])("rejects %j with a readable reason", (rule, message) => {
    expect(() => parseRule(rule)).toThrowError(RuleError);
    expect(() => parseRule(rule)).toThrowError(message);
  });
});

describe("occurrences", () => {
  it("sells quarterly service from the start date", () => {
    expect(occurrences("FREQ=MONTHLY;INTERVAL=3", d("2026-10-14"), d("2026-10-01"), d("2027-10-31"))).toEqual([
      "2026-10-14", "2027-01-14", "2027-04-14", "2027-07-14", "2027-10-14",
    ]);
  });

  it("keeps a customer on the 31st in every month instead of skipping short months", () => {
    expect(occurrences("FREQ=MONTHLY", d("2027-01-31"), d("2027-01-01"), d("2027-05-31"))).toEqual([
      "2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31",
    ]);
    expect(occurrences("FREQ=YEARLY", d("2028-02-29"), d("2028-01-01"), d("2030-12-31"))).toEqual([
      "2028-02-29", "2029-02-28", "2030-02-28",
    ]);
  });

  it("runs lawn rounds and mosquito seasons only in their months", () => {
    expect(occurrences("FREQ=YEARLY;BYMONTH=3,5,9", d("2027-03-15"), d("2027-01-01"), d("2028-06-30"))).toEqual([
      "2027-03-15", "2027-05-15", "2027-09-15", "2028-03-15", "2028-05-15",
    ]);
    const mosquito = occurrences("FREQ=WEEKLY;INTERVAL=3;BYMONTH=5,6,7,8,9", d("2027-05-04"), d("2027-01-01"), d("2027-12-31"));
    expect(mosquito[0]).toBe("2027-05-04");
    expect(mosquito.every((x) => x >= "2027-05-01" && x <= "2027-09-30")).toBe(true);
  });

  it("finds the nth and last weekday", () => {
    expect(occurrences("FREQ=MONTHLY;BYDAY=2TU", d("2026-10-01"), d("2026-10-01"), d("2026-12-31"))).toEqual([
      "2026-10-13", "2026-11-10", "2026-12-08",
    ]);
    expect(occurrences("FREQ=MONTHLY;BYDAY=-1FR", d("2026-10-01"), d("2026-10-01"), d("2026-12-31"))).toEqual([
      "2026-10-30", "2026-11-27", "2026-12-25",
    ]);
  });

  it("never returns dates before the start or outside the window", () => {
    expect(occurrences("FREQ=MONTHLY", d("2026-10-14"), d("2026-01-01"), d("2026-10-13"))).toEqual([]);
    expect(occurrences("FREQ=WEEKLY;BYDAY=MO,TH", d("2026-10-08"), d("2026-10-01"), d("2026-10-16"))).toEqual([
      "2026-10-08", "2026-10-12", "2026-10-15",
    ]);
  });

  it("is unaffected by daylight saving time: weekly Tuesdays stay Tuesdays at 8:00 local", () => {
    // DST starts 2027-03-14 and ends 2027-11-07 in Denver.
    const visits = occurrences("FREQ=WEEKLY", d("2027-03-02"), d("2027-03-01"), d("2027-03-31"));
    expect(visits).toEqual(["2027-03-02", "2027-03-09", "2027-03-16", "2027-03-23", "2027-03-30"]);
    const utcHours = visits.map((v) => zonedTimeToInstant(v, t("08:00"), "America/Denver").getUTCHours());
    expect(utcHours).toEqual([15, 15, 14, 14, 14]);

    const fall = occurrences("FREQ=WEEKLY", d("2027-10-26"), d("2027-10-01"), d("2027-11-16"));
    expect(fall).toEqual(["2027-10-26", "2027-11-02", "2027-11-09", "2027-11-16"]);
    expect(fall.map((v) => zonedTimeToInstant(v, t("08:00"), "America/Denver").getUTCHours())).toEqual([14, 14, 15, 15]);
  });

  it("returns the same dates however the window is sliced (generation is idempotent)", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH";
    const start = d("2026-10-05");
    const whole = occurrences(rule, start, start, d("2027-06-30"));
    const sliced: string[] = [];
    for (let from = start; from <= d("2027-06-30"); from = addDays(from, 17)) {
      const to = addDays(from, 16);
      sliced.push(...occurrences(rule, start, from, to > d("2027-06-30") ? d("2027-06-30") : to));
    }
    expect(sliced).toEqual(whole);
  });
});

// Cross-check against the reference RRULE implementation wherever RFC 5545
// and our clamping agree (start day <= 28).
const weekdayArb = fc.constantFrom<Weekday>("MO", "TU", "WE", "TH", "FR", "SA", "SU");
const ruleArb: fc.Arbitrary<Rule> = fc.oneof(
  fc.record({
    freq: fc.constant("DAILY" as const),
    interval: fc.integer({ min: 1, max: 10 }),
    byMonth: fc.option(fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 6 }), { nil: undefined }),
  }),
  fc.record({
    freq: fc.constant("WEEKLY" as const),
    interval: fc.integer({ min: 1, max: 6 }),
    byWeekday: fc.option(fc.uniqueArray(weekdayArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    byMonth: fc.option(fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 6 }), { nil: undefined }),
  }),
  fc.record({
    freq: fc.constant("MONTHLY" as const),
    interval: fc.integer({ min: 1, max: 6 }),
    byNthWeekday: fc.option(fc.record({ n: fc.constantFrom(1, 2, 3, 4, -1), weekday: weekdayArb }), { nil: undefined }),
    byMonth: fc.option(fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 6 }), { nil: undefined }),
  }),
  fc.record({
    freq: fc.constant("YEARLY" as const),
    interval: fc.integer({ min: 1, max: 3 }),
    byMonth: fc.option(fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 6 }), { nil: undefined }),
  }),
);

function referenceDates(rule: Rule, start: LocalDate, from: LocalDate, to: LocalDate): string[] {
  const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const r = new RRule({ ...RRule.parseString(formatRule(rule)), dtstart: new Date(Date.UTC(sy, sm - 1, sd)) });
  const toDate = (x: LocalDate) => {
    const [y, m, dd] = x.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, dd));
  };
  return r.between(toDate(from), toDate(to), true).map((x) => x.toISOString().slice(0, 10));
}

describe("agreement with RFC 5545 (rrule)", () => {
  it("matches the reference implementation for start days 1-28", () => {
    fc.assert(
      fc.property(
        ruleArb,
        fc.integer({ min: 2024, max: 2030 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 400 }),
        (rawRule, y, m, day, fromOffset) => {
          const rule = parseRule(formatRule(rawRule as Rule));
          const start = makeLocalDate(y, m, day);
          const from = addDays(start, fromOffset - 30);
          const to = addDays(from, 730);
          expect(occurrences(rule, start, from, to)).toEqual(referenceDates(rule, start, from, to));
        },
      ),
      { numRuns: 600 },
    );
  }, 60_000);
});

describe("describeRule", () => {
  it("reads like the plan sheet", () => {
    expect(describeRule("FREQ=MONTHLY;INTERVAL=3", d("2026-10-14"))).toBe("Every 3 months (quarterly) on the 14th");
    expect(describeRule("FREQ=MONTHLY", d("2026-10-31"))).toBe("Every month on the 31st (or the month's last day)");
    expect(describeRule("FREQ=WEEKLY;INTERVAL=2", d("2026-10-06"))).toBe("Every 2 weeks on Tuesday");
    expect(describeRule("FREQ=YEARLY;BYMONTH=3,5,9", d("2027-03-15"))).toBe("Every year in March, May and September on the 15th");
    expect(describeRule("FREQ=MONTHLY;BYDAY=2TU")).toBe("Every month on the second Tuesday");
    expect(describeRule("FREQ=WEEKLY;INTERVAL=3;BYMONTH=5,6,7,8,9", d("2027-05-04"))).toBe(
      "Every 3 weeks on Tuesday, May to September only",
    );
  });
});
