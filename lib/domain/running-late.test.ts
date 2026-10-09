import { describe, expect, it } from "vitest";
import { lateLabel, shiftWindow } from "./running-late";

describe("running late (FR-TEC-02, FR-MSG-01)", () => {
  it("moves both ends of a window later", () => {
    expect(shiftWindow("08:00", "12:00", 30)).toEqual({ start: "08:30", end: "12:30" });
    expect(shiftWindow("10:45", "13:00", 60)).toEqual({ start: "11:45", end: "14:00" });
  });
  it("keeps a missing end missing", () => {
    expect(shiftWindow(null, "12:00", 15)).toEqual({ start: null, end: "12:15" });
    expect(shiftWindow(null, null, 15)).toEqual({ start: null, end: null });
  });
  it("never runs past the end of the day", () => {
    expect(shiftWindow("23:30", "23:50", 60)).toEqual({ start: "23:59", end: "23:59" });
  });
  it("labels the delay", () => {
    expect(lateLabel(30)).toBe("Running late +30 min");
  });
});
