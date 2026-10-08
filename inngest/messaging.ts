import "server-only";
import { billEveryone, remindAll } from "@/lib/jobs/daily";
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

export const messagingFunctions = [outboxSweep, dailyReminders, nightlyBilling];
