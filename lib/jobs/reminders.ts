import "server-only";
import { withServiceRole } from "@/lib/db/service";
import { addDays, todayIn } from "@/lib/domain/time";
import { enqueueEmail } from "@/lib/messaging/enqueue";

// FR-MSG-01: tomorrow's customers get a reminder. Queued once per visit and
// date (a rerun adds nothing); checked again when sent, so a visit moved or
// cancelled in between is not announced (lib/jobs/outbox.ts).

export async function queueReminders(tenantId: string, now = new Date()): Promise<number> {
  return withServiceRole(async (tx) => {
    const tenant = await tx.selectFrom("tenants").select("timezone").where("id", "=", tenantId).executeTakeFirstOrThrow();
    const tomorrow = addDays(todayIn(tenant.timezone, now), 1);
    const visits = await tx
      .selectFrom("appointments")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "scheduled")
      .where("local_date", "=", tomorrow)
      .execute();
    for (const v of visits) {
      await enqueueEmail(tx, { tenantId, topic: "appointment.reminder", key: `${v.id}:${tomorrow}`, payload: { appointmentId: v.id, date: tomorrow } });
    }
    return visits.length;
  });
}
