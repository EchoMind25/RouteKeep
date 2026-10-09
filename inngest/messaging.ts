import "server-only";
import { z } from "zod";
import { chargeDueAutopay, type AutopayResult } from "@/lib/jobs/autopay";
import { billTenant } from "@/lib/jobs/billing";
import { remindAll, telemetryRetention } from "@/lib/jobs/daily";
import { listTenantIds } from "@/lib/jobs/generate-appointments";
import { reconcileIntents, reconcileRefunds, reconcileSweep } from "@/lib/jobs/reconcile";
import { processOutbox } from "@/lib/jobs/outbox";
import { inngest } from "./client";

// ENG-04, FR-MSG-01, FR-BIL-03: the outbox every five minutes (a backstop:
// most messages go right after the request that queued them), tomorrow's
// reminders each afternoon, and the billing run each night.

const BILLING_EVENT = "billing/tenant.requested";
const PAYMENTS_EVENT = "payments/tenant.requested";
// D-04: one run per business, five businesses at once across the fleet.
const TENANT_CONCURRENCY: [{ key: string; limit: number }, { limit: number }] = [{ key: "event.data.tenantId", limit: 1 }, { limit: 5 }];
// Each pass is a step under the 20 s limit; a tenant with a backlog loops until complete.
const MAX_PASSES = 200;
const tenantEvent = z.object({ tenantId: z.uuid() });

export const outboxSweep = inngest.createFunction({ id: "outbox-sweep", triggers: [{ cron: "*/5 * * * *" }] }, async ({ step }) =>
  step.run("send", () => processOutbox({ limit: 200 })),
);

export const dailyReminders = inngest.createFunction({ id: "reminders-daily", triggers: [{ cron: "TZ=America/Denver 5 16 * * *" }] }, async ({ step }) =>
  step.run("queue-and-send", () => remindAll()),
);

// D-04, FR-BIL-01: the billing run fans out one event per business (the
// function id is unchanged but it is now only the dispatcher), so one
// business's failure never blocks or re-runs another's.
export const nightlyBilling = inngest.createFunction({ id: "billing-nightly", triggers: [{ cron: "TZ=America/Denver 45 2 * * *" }] }, async ({ step }) => {
  const tenantIds = await step.run("list-tenants", () => listTenantIds());
  if (tenantIds.length > 0) await step.sendEvent("fan-out", tenantIds.map((tenantId) => ({ name: BILLING_EVENT, data: { tenantId } })));
  return { tenants: tenantIds.length };
});

export const tenantBilling = inngest.createFunction(
  { id: "billing-tenant", triggers: [{ event: BILLING_EVENT }], concurrency: TENANT_CONCURRENCY, retries: 2 },
  async ({ event, step }) => {
    const { tenantId } = tenantEvent.parse(event.data);
    // FR-BIL-03, D-04: resumable (invoiced visits drop out), so loop until complete.
    let invoices = 0;
    let failures = 0;
    let complete = false;
    for (let i = 0; i < MAX_PASSES; i++) {
      const r = await step.run(`bill-${i}`, async () => {
        const r = await billTenant(tenantId);
        return { invoices: r.invoicesCreated, failures: r.failures.length, complete: r.complete };
      });
      invoices += r.invoices;
      failures += r.failures;
      if (r.complete) {
        complete = true;
        break;
      }
    }
    return { tenantId, invoices, failures, complete };
  },
);

// FR-BIL-02/04/07: autopay charges and retries, then the reconciliation
// against Stripe, after the billing run. Fan-out per business; each business's
// reconciliation is three steps so every one stays under 20 s (D-04).
export const nightlyPayments = inngest.createFunction({ id: "payments-nightly", triggers: [{ cron: "TZ=America/Denver 30 3 * * *" }] }, async ({ step }) => {
  const tenantIds = await step.run("list-tenants", () => listTenantIds());
  if (tenantIds.length > 0) await step.sendEvent("fan-out", tenantIds.map((tenantId) => ({ name: PAYMENTS_EVENT, data: { tenantId } })));
  return { tenants: tenantIds.length };
});

export const tenantPayments = inngest.createFunction(
  { id: "payments-tenant", triggers: [{ event: PAYMENTS_EVENT }], concurrency: TENANT_CONCURRENCY, retries: 2 },
  async ({ event, step }) => {
    const { tenantId } = tenantEvent.parse(event.data);
    // FR-BIL-02, D-04: each pass is bounded; loop until nothing is left due.
    let autopay: AutopayResult | undefined;
    for (let i = 0; i < MAX_PASSES; i++) {
      const r: AutopayResult = await step.run(`autopay-${i}`, () => chargeDueAutopay(tenantId));
      autopay = autopay ? { charged: autopay.charged + r.charged, processing: autopay.processing + r.processing, failed: autopay.failed + r.failed, skipped: autopay.skipped + r.skipped, complete: r.complete } : r;
      if (r.complete) break;
    }
    const intents = await step.run("reconcile-intents", async () => (await reconcileIntents(tenantId)) ?? { skipped: true });
    const refunds = await step.run("reconcile-refunds", async () => (await reconcileRefunds(tenantId)) ?? { skipped: true });
    // Per-payment sweep errors come back in the result rather than failing the step.
    const sweep = await step.run("reconcile-sweep", async () => (await reconcileSweep(tenantId)) ?? { skipped: true });
    return { tenantId, autopay, intents, refunds, sweep };
  },
);

// OPS-03: raw product events are kept 180 days (data-collection contract section 6).
export const telemetryRetentionDaily = inngest.createFunction({ id: "telemetry-retention-daily", triggers: [{ cron: "TZ=America/Denver 15 4 * * *" }] }, async ({ step }) =>
  step.run("purge", () => telemetryRetention()),
);

export const messagingFunctions = [outboxSweep, dailyReminders, nightlyBilling, tenantBilling, nightlyPayments, tenantPayments, telemetryRetentionDaily];
