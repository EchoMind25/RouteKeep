import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  dayOfWeek,
  daysBetween,
  instantToZoned,
  isIanaZone,
  isLocalDate,
  parseLocalDate as d,
  parseLocalTime as t,
  todayIn,
  zoneOffsetMinutes,
  zonedTimeToInstant,
} from "./time";

const DENVER = "America/Denver";

describe("calendar dates", () => {
  it("rejects dates that do not exist", () => {
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-1-01")).toBe(false);
  });

  it("adds days across month, year and DST boundaries without drifting", () => {
    expect(addDays(d("2026-03-07"), 1)).toBe("2026-03-08");
    expect(addDays(d("2026-03-08"), 1)).toBe("2026-03-09");
    expect(addDays(d("2026-10-31"), 1)).toBe("2026-11-01");
    expect(addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(d("2026-01-01"), -1)).toBe("2025-12-31");
  });

  it("clamps month arithmetic to the end of short months", () => {
    expect(addMonthsClamped(d("2026-01-31"), 1)).toBe("2026-02-28");
    expect(addMonthsClamped(d("2028-01-31"), 1)).toBe("2028-02-29");
    expect(addMonthsClamped(d("2026-08-31"), 3)).toBe("2026-11-30");
    expect(addMonthsClamped(d("2026-11-15"), 3)).toBe("2027-02-15");
    expect(addMonthsClamped(d("2026-03-15"), -3)).toBe("2025-12-15");
  });

  it("knows the weekday", () => {
    expect(dayOfWeek(d("2026-10-06"))).toBe(2); // Tuesday
    expect(dayOfWeek(d("2026-03-08"))).toBe(0); // Sunday, DST starts in the US
  });

  it("round-trips addDays and daysBetween", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20000 }), fc.integer({ min: -3000, max: 3000 }), (offset, n) => {
        const start = addDays(d("2000-01-01"), offset);
        expect(daysBetween(start, addDays(start, n))).toBe(n);
      }),
    );
  });
});

describe("zones", () => {
  it("accepts region names and UTC, refuses abbreviations and offsets", () => {
    expect(isIanaZone("America/Denver")).toBe(true);
    expect(isIanaZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isIanaZone("UTC")).toBe(true);
    expect(isIanaZone("MST")).toBe(false);
    expect(isIanaZone("MST7MDT")).toBe(false);
    expect(isIanaZone("Etc/GMT+7")).toBe(false);
    expect(isIanaZone("US/Mountain")).toBe(false);
    expect(isIanaZone("America/Nowhere")).toBe(false);
  });

  it("reports Denver offsets on both sides of each 2026 change", () => {
    expect(zoneOffsetMinutes(DENVER, new Date("2026-03-08T08:59:00Z"))).toBe(-420);
    expect(zoneOffsetMinutes(DENVER, new Date("2026-03-08T09:00:00Z"))).toBe(-360);
    expect(zoneOffsetMinutes(DENVER, new Date("2026-11-01T07:59:00Z"))).toBe(-360);
    expect(zoneOffsetMinutes(DENVER, new Date("2026-11-01T08:00:00Z"))).toBe(-420);
    expect(zoneOffsetMinutes("America/Phoenix", new Date("2026-07-01T12:00:00Z"))).toBe(-420);
  });

  it("keeps an 8:00 window at 8:00 local across both DST changes", () => {
    expect(zonedTimeToInstant(d("2026-03-07"), t("08:00"), DENVER).toISOString()).toBe("2026-03-07T15:00:00.000Z");
    expect(zonedTimeToInstant(d("2026-03-09"), t("08:00"), DENVER).toISOString()).toBe("2026-03-09T14:00:00.000Z");
    expect(zonedTimeToInstant(d("2026-10-31"), t("08:00"), DENVER).toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(zonedTimeToInstant(d("2026-11-02"), t("08:00"), DENVER).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("moves a time skipped by spring-forward later by the gap", () => {
    const i = zonedTimeToInstant(d("2026-03-08"), t("02:30"), DENVER);
    expect(i.toISOString()).toBe("2026-03-08T09:30:00.000Z");
    expect(instantToZoned(i, DENVER)).toEqual({ date: "2026-03-08", time: "03:30" });
  });

  it("resolves a time repeated by fall-back to its first occurrence", () => {
    expect(zonedTimeToInstant(d("2026-11-01"), t("01:30"), DENVER).toISOString()).toBe("2026-11-01T07:30:00.000Z");
    // Same rule east of Greenwich (positive offsets).
    expect(zonedTimeToInstant(d("2026-10-25"), t("02:30"), "Europe/Berlin").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("gives today's date in the tenant's zone, not the server's", () => {
    const lateEvening = new Date("2026-10-07T04:30:00Z"); // 22:30 on Oct 6 in Denver
    expect(todayIn(DENVER, lateEvening)).toBe("2026-10-06");
    expect(todayIn("UTC", lateEvening)).toBe("2026-10-07");
  });

  const zones = [DENVER, "America/Phoenix", "America/Boise", "America/New_York", "Pacific/Honolulu", "Europe/Berlin", "Australia/Sydney"];

  it("round-trips any instant through wall-clock time (to the minute)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1) / 60_000, max: Date.UTC(2035, 11, 31) / 60_000 }),
        fc.constantFrom(...zones),
        (minute, zone) => {
          const instant = new Date(minute * 60_000);
          const { date, time } = instantToZoned(instant, zone);
          const back = zonedTimeToInstant(date, time, zone);
          // Equal, or the earlier twin of a repeated fall-back hour.
          expect(instantToZoned(back, zone)).toEqual({ date, time });
          expect(back.getTime()).toBeLessThanOrEqual(instant.getTime());
          expect(instant.getTime() - back.getTime()).toBeLessThanOrEqual(60 * 60_000);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("maps every wall time to an instant that shows the same time, or later only inside a gap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 365 * 10 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.constantFrom(...zones),
        (dayOffset, hh, mm, zone) => {
          const date = addDays(d("2024-01-01"), dayOffset);
          const time = t(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
          const shown = instantToZoned(zonedTimeToInstant(date, time, zone), zone);
          if (shown.date === date && shown.time === time) return;
          // Only spring-forward gaps may shift, and only forward, by at most an hour.
          expect(shown.date).toBe(date);
          expect(shown.time > time).toBe(true);
          const [sh, sm] = shown.time.split(":").map(Number) as [number, number];
          expect(sh * 60 + sm - (hh * 60 + mm)).toBeLessThanOrEqual(60);
        },
      ),
      { numRuns: 3000 },
    );
  });
});
