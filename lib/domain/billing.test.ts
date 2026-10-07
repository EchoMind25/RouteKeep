import { describe, expect, it } from "vitest";
import { agingBucket, billingPeriod, periodClosed } from "./billing";
import { parseLocalDate as d } from "./time";

describe("billing periods (FR-BIL-01)", () => {
  it("gives each mode its own period key and end", () => {
    expect(billingPeriod(d("2026-10-14"), "per_service")).toEqual({ key: "2026-10-14", start: "2026-10-14", end: "2026-10-14" });
    expect(billingPeriod(d("2026-02-14"), "monthly")).toEqual({ key: "2026-02", start: "2026-02-01", end: "2026-02-28" });
    expect(billingPeriod(d("2028-02-03"), "monthly").end).toBe("2028-02-29");
    expect(billingPeriod(d("2026-11-30"), "quarterly")).toEqual({ key: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
    expect(billingPeriod(d("2026-01-01"), "quarterly").key).toBe("2026-Q1");
    expect(billingPeriod(d("2026-07-04"), "annually")).toEqual({ key: "2026", start: "2026-01-01", end: "2026-12-31" });
  });

  it("closes a period the day after it ends", () => {
    const october = billingPeriod(d("2026-10-14"), "monthly");
    expect(periodClosed(october, d("2026-10-31"))).toBe(false);
    expect(periodClosed(october, d("2026-11-01"))).toBe(true);
  });
});

describe("aging (FR-BIL-04, FR-BIL-08)", () => {
  it("buckets by days past due", () => {
    const due = d("2026-10-01");
    expect(agingBucket(due, d("2026-10-01"))).toBe("current");
    expect(agingBucket(due, d("2026-10-31"))).toBe("1-30");
    expect(agingBucket(due, d("2026-11-01"))).toBe("31-60");
    expect(agingBucket(due, d("2026-12-30"))).toBe("61-90");
    expect(agingBucket(due, d("2026-12-31"))).toBe("90+");
  });
});
