import { describe, expect, it } from "vitest";
import { AUTOPAY_MAX_ATTEMPTS, autopayConsent, canMove, declineText, intentGivenUp, methodLabel, needsNewMethod, nextAutopayAttempt, sessionVerdict, stuckKind, takenButNotOurs } from "./payments";

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

describe("FR-BIL-07 stuck payment sweeper decisions", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const base = { status: "pending" as const, sessionId: null, intentId: null };
  it("picks portal payments after an hour, by whether a session exists", () => {
    expect(stuckKind({ ...base, source: "portal", createdAt: ago(61 * 60_000), sessionId: "cs_1" }, now)).toBe("portal-session");
    expect(stuckKind({ ...base, source: "portal", createdAt: ago(61 * 60_000) }, now)).toBe("portal-no-session");
    expect(stuckKind({ ...base, source: "portal", createdAt: ago(59 * 60_000), sessionId: "cs_1" }, now)).toBeNull();
  });
  it("picks autopay payments with an intent after a day, never without one", () => {
    expect(stuckKind({ ...base, source: "autopay", createdAt: ago(25 * 3_600_000), intentId: "pi_1" }, now)).toBe("autopay-intent");
    expect(stuckKind({ ...base, source: "autopay", createdAt: ago(23 * 3_600_000), intentId: "pi_1" }, now)).toBeNull();
    expect(stuckKind({ ...base, source: "autopay", createdAt: ago(48 * 3_600_000) }, now)).toBeNull();
  });
  it("leaves anything not pending alone", () => {
    expect(stuckKind({ ...base, status: "processing", source: "portal", createdAt: ago(9e9) }, now)).toBeNull();
  });
  it("reads a Checkout session: complete, expired, or open past its expiry", () => {
    const at = Math.floor(now.getTime() / 1000);
    expect(sessionVerdict({ status: "complete", expires_at: at - 10 }, now)).toBe("complete");
    expect(sessionVerdict({ status: "expired", expires_at: at + 10 }, now)).toBe("canceled");
    expect(sessionVerdict({ status: "open", expires_at: at - 10 }, now)).toBe("canceled");
    expect(sessionVerdict({ status: "open", expires_at: at + 10 }, now)).toBe("wait");
  });
  it("gives up on intents still waiting on the customer", () => {
    expect(intentGivenUp("requires_action")).toBe(true);
    expect(intentGivenUp("requires_payment_method")).toBe(true);
    expect(intentGivenUp("processing")).toBe(false);
    expect(intentGivenUp("succeeded")).toBe(false);
  });
});

describe("FR-BIL-07 money taken for a payment we closed", () => {
  it("flags a success against a canceled or failed payment, nothing else", () => {
    expect(takenButNotOurs("canceled", "succeeded")).toBe(true);
    expect(takenButNotOurs("failed", "succeeded")).toBe(true);
    expect(takenButNotOurs("pending", "succeeded")).toBe(false);
    expect(takenButNotOurs("processing", "succeeded")).toBe(false);
    expect(takenButNotOurs("canceled", "failed")).toBe(false);
  });
});
