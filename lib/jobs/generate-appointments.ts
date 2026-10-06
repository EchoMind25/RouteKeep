import "server-only";
import { withServiceRole } from "@/lib/db/service";
import { generateVisits } from "@/lib/server/generation";

// FR-SUB-02: nightly generation, 60 days ahead. Work is cut into batches that
// each finish well inside the 20 s request limit (D-04); a durable job runner
// (Inngest) runs one batch per step, so a failure retries only that batch.

export const GENERATION_BATCH = 400;

export async function listTenantIds(): Promise<string[]> {
  return withServiceRole(async (tx) => (await tx.selectFrom("tenants").select("id").orderBy("id").execute()).map((t) => t.id));
}

/** One batch for one tenant. Returns the cursor for the next batch, or null when done. */
export async function generateBatch(tenantId: string, afterId: string | null, now = new Date()) {
  return withServiceRole((tx) => generateVisits(tx, tenantId, { afterId: afterId ?? undefined, limit: GENERATION_BATCH, now }));
}

/** Runs every batch for every tenant in-process (local scripts and tests). */
export async function generateAll(now = new Date()) {
  let subscriptions = 0;
  let created = 0;
  for (const tenantId of await listTenantIds()) {
    let cursor: string | null = null;
    do {
      const result: Awaited<ReturnType<typeof generateBatch>> = await generateBatch(tenantId, cursor, now);
      subscriptions += result.subscriptions;
      created += result.created;
      cursor = result.subscriptions === GENERATION_BATCH ? result.lastId : null;
    } while (cursor);
  }
  return { subscriptions, created };
}
