import { afterEach, describe, expect, it, vi } from "vitest";

// D-04, FR-BIL-02, FR-BIL-03: nightly money jobs report whether they finished.
const withServiceRole = vi.fn();
vi.mock("@/lib/db/service", () => ({ withServiceRole: (...a: unknown[]) => withServiceRole(...a) }));
vi.mock("@/lib/providers/payments", () => ({ stripe: () => ({}), requireStripe: () => ({}), declineOf: () => ({}) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./outbox", () => ({ processOutbox: vi.fn() }));
vi.mock("./stripe-ledger", () => ({ applyIntent: vi.fn(), movePayment: vi.fn() }));

import { runBilling } from "@/lib/server/billing-run";
import { chargeDueAutopay } from "./autopay";

afterEach(() => withServiceRole.mockReset());

function autopayWith(stuck: number, due: number) {
  let n = 0;
  withServiceRole.mockImplementation(async () => {
    n++;
    if (n === 1) return { stripe_account_id: "acct", stripe_charges_enabled: true };
    if (n === 2) return Array.from({ length: stuck }, () => ({ id: "s", created_at: new Date(0) }));
    if (n === 3) return Array.from({ length: due }, (_, i) => ({ id: `d${i}` }));
    return null; // nothing to charge: skipped
  });
}

describe("chargeDueAutopay complete (FR-BIL-02)", () => {
  it("is complete when under the page limits", async () => {
    autopayWith(0, 99);
    expect((await chargeDueAutopay("t")).complete).toBe(true);
  });
  it("is incomplete on a full page of due invoices", async () => {
    autopayWith(0, 100);
    expect((await chargeDueAutopay("t")).complete).toBe(false);
  });
  it("is incomplete when out of budget", async () => {
    autopayWith(0, 5);
    expect((await chargeDueAutopay("t", new Date(), -1)).complete).toBe(false);
  });
});

describe("runBilling complete (FR-BIL-03)", () => {
  const visit = { id: "v1", customer_id: "c", subscription_id: null, local_date: "2026-01-01", price_cents: 100, is_initial: false, billing_mode: null, service_type: "Lawn" };
  const run = (budgetMs: number) => {
    let n = 0;
    return runBilling(
      async () => {
        n++;
        if (n === 1) return { today: "2026-02-01", runId: "r", visits: [visit] } as never;
        if (n === 2 && budgetMs > 0) return "inv" as never; // the invoice
        return [] as never;
      },
      "t",
      new Date(),
      budgetMs,
    );
  };
  it("is complete within budget", async () => {
    const r = await run(12_000);
    expect(r.complete).toBe(true);
    expect(r.invoicesCreated).toBe(1);
  });
  it("is incomplete when the budget is spent before an item", async () => {
    const r = await run(-1);
    expect(r.complete).toBe(false);
    expect(r.invoicesCreated).toBe(0);
  });
});
