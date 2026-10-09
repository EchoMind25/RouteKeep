import "server-only";
import { chargeDueAutopay } from "./autopay";
import { billTenant } from "./billing";
import { reconcileTenant } from "./reconcile";
import { GENERATION_BATCH, generateBatch, listTenantIds } from "./generate-appointments";
import { processOutbox } from "./outbox";
import { queueReminders } from "./reminders";
import { purgeProductEvents } from "@/lib/telemetry/job";

// The scheduled work outside visit generation, one place for every runner
// (Inngest, /api/cron, the npm scripts). Each piece is idempotent.

const failure = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) });

export async function remindAll(now = new Date()) {
  let queued = 0;
  const failures: { tenantId: string; error: string }[] = [];
  for (const tenantId of await listTenantIds()) {
    try {
      queued += await queueReminders(tenantId, now);
    } catch (error) {
      failures.push({ tenantId, ...failure(error) });
    }
  }
  return { queued, failures, sent: await processOutbox({ limit: 500 }) };
}

export async function billEveryone(now = new Date()) {
  const results = [];
  for (const tenantId of await listTenantIds()) {
    const r = await billTenant(tenantId, now).catch(failure);
    results.push({ tenantId, ...r });
  }
  return results;
}

/** OPS-03: product events older than 180 days are deleted (data-collection contract section 6). */
export async function telemetryRetention() {
  return purgeProductEvents();
}

/** FR-BIL-02/04: autopay charges and retries that are due, every business. */
export async function autopayEveryone(now = new Date()) {
  const results = [];
  for (const tenantId of await listTenantIds()) {
    const r = await chargeDueAutopay(tenantId, now).catch(failure);
    results.push({ tenantId, ...r });
  }
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

/**
 * FR-SUB-02: visit generation for every business within a time budget. A run
 * that ran out of time reports complete=false so the scheduler calls again;
 * inserts are idempotent (ENG-01), so reruns only add what is missing.
 */
export async function generateEveryone(now = new Date(), budgetMs = 15_000) {
  const started = Date.now();
  let created = 0;
  let complete = true;
  const failures: { tenantId: string; error: string }[] = [];
  for (const tenantId of await listTenantIds()) {
    let cursor: string | null = null;
    try {
      do {
        if (Date.now() - started >= budgetMs) {
          complete = false;
          break;
        }
        const r: Awaited<ReturnType<typeof generateBatch>> = await generateBatch(tenantId, cursor, now);
        created += r.created;
        cursor = r.subscriptions === GENERATION_BATCH ? r.lastId : null;
      } while (cursor);
    } catch (error) {
      failures.push({ tenantId, ...failure(error) });
    }
    if (!complete) break;
  }
  return { created, complete, failures };
}
