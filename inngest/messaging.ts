import "server-only";
import { chargeDueAutopay } from "@/lib/jobs/autopay";
import { billEveryone, remindAll } from "@/lib/jobs/daily";
import { listTenantIds } from "@/lib/jobs/generate-appointments";
import { reconcileTenant } from "@/lib/jobs/reconcile";
import { processOutbox } from "@/lib/jobs/outbox";
import { inngest } from "./client";

// ENG-04, FR-MSG-01, FR-BIL-03: the outbox every five minutes (a backstop:
// most messages go right after the request that queued them), tomorrow's
// reminders each afternoon, and the billing run each night.

export const outboxSweep = inngest.createFunction({ id: "outbox-sweep", triggers: [{ cron: "*/5 * * * *" }] }, async ({ step }) =>
  step.run("send", () => processOutbox({ limit: 200 })),
);

export const dailyReminders = inngest.createFunction({ id: "reminders-daily", triggers: [{ cron: "TZ=America/Denver 5 16 * * *" }] }, async ({ step }) =>
  step.run("queue-and-send", () => remindAll()),
);

export const nightlyBilling = inngest.createFunction({ id: "billing-nightly", triggers: [{ cron: "TZ=America/Denver 45 2 * * *" }], retries: 2 }, async ({ step }) =>
  step.run("bill", async () => (await billEveryone()).map((r) => ({ tenantId: r.tenantId, invoices: r.invoicesCreated, failures: r.failures.length }))),
);

// FR-BIL-02/04/07: autopay charges and retries after the billing run, then the
// reconciliation against Stripe. One step per business keeps each under 20 s (D-04).
export const nightlyPayments = inngest.createFunction({ id: "payments-nightly", triggers: [{ cron: "TZ=America/Denver 30 3 * * *" }], retries: 2 }, async ({ step }) => {
  const tenants = await step.run("tenants", () => listTenantIds());
  for (const tenantId of tenants) {
    await step.run(`autopay-${tenantId}`, () => chargeDueAutopay(tenantId));
    await step.run(`reconcile-${tenantId}`, async () => (await reconcileTenant(tenantId)) ?? { skipped: true });
  }
});

export const messagingFunctions = [outboxSweep, dailyReminders, nightlyBilling, nightlyPayments];
