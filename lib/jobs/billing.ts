import "server-only";
import { withServiceRole } from "@/lib/db/service";
import { runBilling } from "@/lib/server/billing-run";
import { listTenantIds } from "./generate-appointments";

// FR-BIL-03: the nightly billing run, one tenant at a time, each invoice in
// its own transaction (lib/server/billing-run.ts). A durable runner (Inngest,
// D-04) calls billTenant once per tenant as its own step.

export function billTenant(tenantId: string, now = new Date()) {
  return runBilling((fn) => withServiceRole(fn), tenantId, now);
}

export async function billAll(now = new Date()) {
  const results = [];
  for (const tenantId of await listTenantIds()) results.push({ tenantId, ...(await billTenant(tenantId, now)) });
  return results;
}
