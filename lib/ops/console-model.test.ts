import { describe, expect, it } from "vitest";
import { healthChecks, planUsage, tenantFlags, worstTone, type OpsHealth, type OpsTenant } from "./console-model";

const now = new Date("2026-10-09T12:00:00Z");

const healthy: OpsHealth = {
  checked_at: now.toISOString(),
  tenants: 2,
  tenants_new_30d: 1,
  active_customers: 400,
  outbox: { pending: 0, retrying: 0, oldest_pending_at: null },
  messages_24h: { sent: 10, failed: 0, suppressed: 1 },
  webhooks: { unprocessed: 0, unprocessed_over_5m: 0, errors_24h: 0 },
  payments: { succeeded_30d: 40, succeeded_cents_30d: 520000, failed_7d: 0, stuck: 0 },
  reconciliation_open: 0,
  billing: { last_finished_at: "2026-10-09T06:00:00Z", unfinished_over_1h: 0, runs_with_failures_7d: 0 },
  imports: { in_progress: 0, failed_7d: 0 },
  exports: { in_progress: 0, failed_7d: 0 },
  route_ai: { runs_7d: 3, failed_7d: 0 },
  sync_conflicts_open: 0,
};

const tenant: OpsTenant = {
  tenantId: "t1",
  name: "Demo",
  plan: "starter",
  state: "UT",
  createdAt: "2026-10-01T00:00:00Z",
  members: 3,
  activeCustomers: 120,
  visitsCompleted30d: 80,
  stripeChargesEnabled: true,
  whiteLabel: false,
  messagingLive: true,
  openReconciliation: 0,
  stuckPayments: 0,
  failedPayments7d: 0,
  failedMessages7d: 0,
  openSyncConflicts: 0,
  lastBillingRun: null,
};

describe("OPS-01: plan usage (D-11)", () => {
  it("measures active customers against the plan limit", () => {
    expect(planUsage("starter", 150)).toEqual({ cap: 300, pct: 50, tone: "neutral" });
    expect(planUsage("pro", 1400)).toEqual({ cap: 1500, pct: 93, tone: "warning" });
    expect(planUsage("growth", 5001).tone).toBe("danger");
    expect(planUsage("unknown", 10)).toEqual({ cap: null, pct: null, tone: "neutral" });
  });
});

describe("OPS-01: tenant flags", () => {
  it("is empty for a business with nothing wrong", () => {
    expect(tenantFlags(tenant)).toEqual([]);
  });

  it("lists money problems first", () => {
    const flags = tenantFlags({ ...tenant, stuckPayments: 2, failedMessages7d: 1, openReconciliation: 1, activeCustomers: 400 });
    expect(flags.map((f) => f.label)).toEqual(["2 stuck payments", "1 Stripe mismatch", "Over plan limit", "1 failed email (7 days)"]);
    expect(flags[0]!.tone).toBe("danger");
  });
});

describe("OPS-01: health checks", () => {
  it("is all green when nothing is waiting or failing", () => {
    expect(worstTone(healthChecks(healthy, now).map((c) => c.tone))).toBe("success");
  });

  it("warns on an email waiting over 15 minutes and alarms over an hour", () => {
    const at = (min: number) => healthChecks({ ...healthy, outbox: { pending: 1, retrying: 1, oldest_pending_at: new Date(now.getTime() - min * 60_000).toISOString() } }, now).find((c) => c.key === "outbox")!;
    expect(at(5).tone).toBe("success");
    expect(at(20).tone).toBe("warning");
    expect(at(90).tone).toBe("danger");
    expect(at(90).detail).toBe("Oldest waiting 2 h; 1 retrying.");
  });

  it("alarms on stuck payments, stale webhooks and a hung billing run", () => {
    const checks = healthChecks(
      { ...healthy, payments: { ...healthy.payments, stuck: 1 }, webhooks: { ...healthy.webhooks, unprocessed: 1, unprocessed_over_5m: 1 }, billing: { ...healthy.billing, unfinished_over_1h: 1 } },
      now,
    );
    expect(checks.filter((c) => c.tone === "danger").map((c) => c.key)).toEqual(["webhooks", "payments", "billing"]);
  });
});
