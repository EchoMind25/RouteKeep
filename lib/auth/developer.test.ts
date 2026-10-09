import { describe, expect, it } from "vitest";
import { developerStep, isDeveloperEmail, parseDeveloperEmails, signedInByEmailCode } from "./developer";

const allowlist = ["dev@example.com"];
const emailCode = [{ method: "otp", timestamp: 1 }];
const base = { email: "dev@example.com", allowlist, aal: "aal1", hasVerifiedFactor: false, amr: emailCode, secondFactorAvailable: true };

describe("OPS-01: developer allowlist", () => {
  it("parses a comma-separated list, trimmed and lower-cased, without blanks or repeats", () => {
    expect(parseDeveloperEmails(" Dev@Example.com, ,ops@example.com,dev@example.com ")).toEqual(["dev@example.com", "ops@example.com"]);
    expect(parseDeveloperEmails(undefined)).toEqual([]);
    expect(parseDeveloperEmails("")).toEqual([]);
  });

  it("matches an email regardless of case, and nothing when the list is empty", () => {
    expect(isDeveloperEmail("DEV@example.com", allowlist)).toBe(true);
    expect(isDeveloperEmail("dev@example.com.evil.test", allowlist)).toBe(false);
    expect(isDeveloperEmail(null, allowlist)).toBe(false);
    expect(isDeveloperEmail("dev@example.com", [])).toBe(false);
  });
});

describe("OPS-01: developer step", () => {
  it("denies anyone not on the list, even at aal2", () => {
    expect(developerStep({ ...base, email: "owner@example.com", aal: "aal2" })).toBe("deny");
    expect(developerStep({ ...base, allowlist: [], aal: "aal2" })).toBe("deny");
  });

  it("always asks a developer for a second factor with Supabase sign-in", () => {
    expect(developerStep(base)).toBe("enroll");
    expect(developerStep({ ...base, hasVerifiedFactor: true })).toBe("verify");
    expect(developerStep({ ...base, aal: undefined, hasVerifiedFactor: true })).toBe("verify");
    expect(developerStep({ ...base, aal: "aal2" })).toBe("allow");
  });

  it("denies a session that did not sign in with an email code, so an unconfirmed password sign-up cannot claim the address", () => {
    expect(developerStep({ ...base, amr: [{ method: "password", timestamp: 1 }], aal: "aal2" })).toBe("deny");
    expect(developerStep({ ...base, amr: undefined, aal: "aal2" })).toBe("deny");
    expect(developerStep({ ...base, amr: [{ method: "otp" }, { method: "totp" }], aal: "aal2" })).toBe("allow");
    expect(signedInByEmailCode(["magiclink"])).toBe(true);
  });

  it("allows local development sign-in, which has no second factor", () => {
    expect(developerStep({ ...base, secondFactorAvailable: false })).toBe("allow");
  });
});
