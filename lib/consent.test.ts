import { describe, expect, it } from "vitest";
import { analyticsPermitted, parseConsent, serializeConsent } from "./consent";

describe("cookie consent (CR-17)", () => {
  it("round-trips a choice", () => {
    for (const analytics of [true, false])
      for (const source of ["banner", "gpc"] as const) expect(parseConsent(serializeConsent({ analytics, source }))).toMatchObject({ analytics, source });
  });

  it("treats a missing, malformed or older-version cookie as no choice", () => {
    for (const v of [undefined, null, "", "yes", "v0.a1.banner", "v1.a2.banner", "v1.a1.other", "v1.a1.banner;x"]) expect(parseConsent(v)).toBeNull();
  });

  it("Essential only turns measurement off, and Global Privacy Control beats an earlier yes", () => {
    expect(analyticsPermitted(null, false)).toBe(true);
    expect(analyticsPermitted(null, true)).toBe(false);
    expect(analyticsPermitted(parseConsent("v1.a0.banner"), false)).toBe(false);
    expect(analyticsPermitted(parseConsent("v1.a1.banner"), false)).toBe(true);
    expect(analyticsPermitted(parseConsent("v1.a1.banner"), true)).toBe(false);
  });
});
