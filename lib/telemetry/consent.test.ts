import { describe, expect, it } from "vitest";
import { ACCEPTED_PREFIX, analyticsAllowedFrom, cookieValue } from "./consent";

describe("banner consent for error reports (OPS-03, opt-in)", () => {
  it("reads one cookie from a cookie string", () => {
    expect(cookieValue("a=1; rv_consent=v1.a1.x; b=2", "rv_consent")).toBe("v1.a1.x");
    expect(cookieValue("a=1", "rv_consent")).toBeNull();
    expect(cookieValue("rv_consent=v1%2Ea1%2Ex", "rv_consent")).toBe("v1.a1.x");
  });
  it("sends only when analytics were accepted", () => {
    expect(ACCEPTED_PREFIX).toBe("v1.a1.");
    expect(analyticsAllowedFrom("rv_consent=v1.a1.20261009", undefined)).toBe(true);
    expect(analyticsAllowedFrom("rv_consent=v1.a0.20261009", undefined)).toBe(false);
    expect(analyticsAllowedFrom("", undefined)).toBe(false);
    expect(analyticsAllowedFrom("other=v1.a1.x", undefined)).toBe(false);
    expect(analyticsAllowedFrom("rv_consent=v2.a1.x", undefined)).toBe(false);
  });
  it("Global Privacy Control always wins", () => {
    expect(analyticsAllowedFrom("rv_consent=v1.a1.x", true)).toBe(false);
    expect(analyticsAllowedFrom("rv_consent=v1.a1.x", false)).toBe(true);
  });
});
