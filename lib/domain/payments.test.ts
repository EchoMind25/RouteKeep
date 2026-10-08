import { describe, expect, it } from "vitest";
import { AUTOPAY_MAX_ATTEMPTS, autopayConsent, canMove, declineText, methodLabel, needsNewMethod, nextAutopayAttempt } from "./payments";

describe("FR-BIL-04 autopay retry schedule", () => {
  const t = new Date("2026-10-09T08:00:00Z");
  it("retries 3 days after the first failure and 4 after the second, then stops", () => {
    expect(nextAutopayAttempt(1, t)?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(nextAutopayAttempt(2, t)?.toISOString()).toBe("2026-10-13T08:00:00.000Z");
    expect(nextAutopayAttempt(3, t)).toBeNull();
    expect(AUTOPAY_MAX_ATTEMPTS).toBe(3);
  });
});

describe("payment status moves", () => {
  it("never moves a succeeded or canceled payment", () => {
    for (const to of ["pending", "processing", "failed", "canceled"] as const) expect(canMove("succeeded", to)).toBe(false);
    expect(canMove("canceled", "succeeded")).toBe(false);
  });
  it("lets a late success win over an earlier failure, but not the reverse", () => {
    expect(canMove("failed", "succeeded")).toBe(true);
    expect(canMove("failed", "processing")).toBe(false);
    expect(canMove("processing", "failed")).toBe(true);
    expect(canMove("processing", "pending")).toBe(false);
    expect(canMove("pending", "processing")).toBe(true);
  });
});

describe("declines", () => {
  it("speaks plainly and flags the ones a retry will not fix", () => {
    expect(declineText("insufficient_funds")).toBe("Not enough funds");
    expect(declineText("something_new")).toBe("The payment was declined");
    expect(needsNewMethod("expired_card")).toBe(true);
    expect(needsNewMethod("insufficient_funds")).toBe(false);
    expect(needsNewMethod(null)).toBe(false);
  });
});

describe("CR-06 labels and consent", () => {
  it("names the method without any number but the last four", () => {
    expect(methodLabel({ kind: "card", brand: "visa", last4: "4242" })).toBe("Visa ending 4242");
    expect(methodLabel({ kind: "card", brand: "newbrand", last4: "1111" })).toBe("Card ending 1111");
    expect(methodLabel({ kind: "us_bank_account", bankName: "STRIPE TEST BANK", last4: "6789" })).toBe("STRIPE TEST BANK ending 6789");
    expect(methodLabel({ kind: "us_bank_account" })).toBe("Bank account");
  });
  it("says how to turn autopay off", () => {
    const text = autopayConsent("Wasatch Pest");
    expect(text).toContain("Wasatch Pest");
    expect(text).toMatch(/turn autopay off at any time/);
    expect(text).not.toMatch(/—/);
  });
});
