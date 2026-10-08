import "server-only";
import { after } from "next/server";
import { processOutbox } from "@/lib/jobs/outbox";

/**
 * ENG-04: after the response is sent (so after the transaction committed),
 * send what this tenant has waiting. The scheduled runner (Inngest or
 * /api/cron) is the backstop when this does not get to finish.
 */
export function kickOutbox(tenantId: string) {
  after(async () => {
    await processOutbox({ tenantId, limit: 20 }).catch((error) =>
      console.error(JSON.stringify({ msg: "outbox kick failed", tenantId, error: error instanceof Error ? error.message : String(error) })),
    );
  });
}
