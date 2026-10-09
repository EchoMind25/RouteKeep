import "server-only";
import { after } from "next/server";
import { processOutbox } from "@/lib/jobs/outbox";
import { errorText, log } from "@/lib/observability/log";

/**
 * ENG-04: after the response is sent (so after the transaction committed),
 * send what this tenant has waiting. The scheduled runner (Inngest or
 * /api/cron) is the backstop when this does not get to finish.
 */
export function kickOutbox(tenantId: string) {
  after(async () => {
    await processOutbox({ tenantId, limit: 20 }).catch((error) =>
      log.error("outbox kick failed", { tenantId, error: errorText(error) }),
    );
  });
}
