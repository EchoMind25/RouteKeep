import { describe, expect, it } from "vitest";
import { mfaStep } from "./mfa";

// CR-15
describe("mfaStep", () => {
  const base = { aal: "aal1", hasVerifiedFactor: false, required: true };
  it("sends owners and admins without a factor to enrol", () => {
    expect(mfaStep({ ...base, role: "owner" })).toBe("enroll");
    expect(mfaStep({ ...base, role: "admin" })).toBe("enroll");
  });
  it("sends owners and admins with a factor at aal1 to verify", () => {
    expect(mfaStep({ ...base, role: "owner", hasVerifiedFactor: true })).toBe("verify");
    expect(mfaStep({ ...base, role: "admin", aal: undefined, hasVerifiedFactor: true })).toBe("verify");
  });
  it("allows aal2", () => {
    expect(mfaStep({ ...base, role: "owner", aal: "aal2", hasVerifiedFactor: true })).toBe("allow");
  });
  it("does not force other roles", () => {
    for (const role of ["office", "dispatcher", "technician"]) expect(mfaStep({ ...base, role })).toBe("allow");
  });
  it("allows everyone when not required (local mode)", () => {
    expect(mfaStep({ ...base, role: "owner", required: false })).toBe("allow");
  });
});
