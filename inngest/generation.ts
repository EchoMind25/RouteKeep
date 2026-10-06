import "server-only";
import { z } from "zod";
import { GENERATION_BATCH, generateBatch, listTenantIds } from "@/lib/jobs/generate-appointments";
import { inngest } from "./client";

// FR-SUB-02: every night, keep 60 days of visits ahead for every tenant.
// Fan-out: one event per tenant, so a failure in one tenant never blocks
// another, and each tenant's work retries on its own.

const TENANT_EVENT = "generation/tenant.requested";

export const nightlyGeneration = inngest.createFunction(
  { id: "generation-nightly", triggers: [{ cron: "TZ=America/Denver 15 2 * * *" }] },
  async ({ step }) => {
    const tenantIds = await step.run("list-tenants", () => listTenantIds());
    if (tenantIds.length > 0) {
      await step.sendEvent(
        "fan-out",
        tenantIds.map((tenantId) => ({ name: TENANT_EVENT, data: { tenantId } })),
      );
    }
    return { tenants: tenantIds.length };
  },
);

export const tenantGeneration = inngest.createFunction(
  {
    id: "generation-tenant",
    triggers: [{ event: TENANT_EVENT }],
    // One run per tenant at a time; inserts are idempotent either way.
    concurrency: { key: "event.data.tenantId", limit: 1 },
    retries: 4,
  },
  async ({ event, step }) => {
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(event.data);
    let cursor: string | null = null;
    let created = 0;
    // Each step stays far below the 20 s limit (D-04) and is safe to retry.
    for (let batch = 0; ; batch++) {
      const result: { subscriptions: number; created: number; lastId: string | null } = await step.run(`batch-${batch}`, () =>
        generateBatch(tenantId, cursor),
      );
      created += result.created;
      if (result.subscriptions < GENERATION_BATCH || !result.lastId) break;
      cursor = result.lastId;
    }
    return { tenantId, created };
  },
);

export const functions = [nightlyGeneration, tenantGeneration];
