import "server-only";
import { billTenant } from "./billing";
import { listTenantIds } from "./generate-appointments";
import { processOutbox } from "./outbox";
import { queueReminders } from "./reminders";

// The scheduled work outside visit generation, one place for every runner
// (Inngest, /api/cron, the npm scripts). Each piece is idempotent.

export async function remindAll(now = new Date()) {
  let queued = 0;
  for (const tenantId of await listTenantIds()) queued += await queueReminders(tenantId, now);
  return { queued, sent: await processOutbox({ limit: 500 }) };
}

export async function billEveryone(now = new Date()) {
  const results = [];
  for (const tenantId of await listTenantIds()) results.push({ tenantId, ...(await billTenant(tenantId, now)) });
  return results;
}
