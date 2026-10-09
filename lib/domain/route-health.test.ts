import { describe, expect, it } from "vitest";
import { routeHealth, routeHealthSummary } from "./route-health";

const t = (id: string, departure: string, late = false) => ({ id, arrival: "08:00", departure, waitMin: 0, late });

describe("routeHealth (FR-DSP-05, FR-DSP-06)", () => {
  it("summarises drive and service time, finish, late stops and long legs", () => {
    const h = routeHealth({ stops: 4, driveSeconds: 2700, serviceMin: 150, timings: [t("a", "09:00"), t("b", "10:30", true), t("c", "13:15", true)], longLegs: 1 });
    expect(h).toEqual({ stops: 4, driveMin: 45, serviceMin: 150, finish: "13:15", lateCount: 2, longLegCount: 1, untimed: 1 });
  });
  it("has no finish for a lane with nothing to time", () => {
    const h = routeHealth({ stops: 2, driveSeconds: 0, serviceMin: 60, timings: [], longLegs: 0 });
    expect(h.finish).toBeNull();
    expect(h.untimed).toBe(2);
  });
  it("reads as a sentence without colour words", () => {
    const h = routeHealth({ stops: 1, driveSeconds: 600, serviceMin: 30, timings: [t("a", "09:40")], longLegs: 0 });
    expect(routeHealthSummary(h, "9:40 AM")).toBe("1 stop, 10 minutes driving and 30 minutes of service, estimated finish 9:40 AM, no stops at risk, no long legs.");
    const late = routeHealth({ stops: 3, driveSeconds: 0, serviceMin: 0, timings: [t("a", "09:40", true)], longLegs: 2 });
    expect(routeHealthSummary(late, null)).toContain("1 stop at risk of missing the window, 2 long legs");
  });
});
