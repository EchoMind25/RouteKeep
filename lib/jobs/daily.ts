import "server-only";
import { chargeDueAutopay } from "./autopay";
import { billTenant } from "./billing";
import { reconcileTenant } from "./reconcile";
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

/** FR-BIL-02/04: autopay charges and retries that are due, every business. */
export async function autopayEveryone(now = new Date()) {
  const results = [];
  for (const tenantId of await listTenantIds()) results.push({ tenantId, ...(await chargeDueAutopay(tenantId, now)) });
  return results;
}

/** FR-BIL-07: the nightly reconciliation against Stripe, every connected business. */
export async function reconcileEveryone(now = new Date()) {
  const results = [];
  for (const tenantId of await listTenantIds()) {
    const r = await reconcileTenant(tenantId, now).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    if (r) results.push({ tenantId, ...r });
  }
  return results;
}
