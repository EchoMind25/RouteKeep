import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { isCurrentVersion } from "@/lib/server/records";
import type { ConflictDetails } from "@/lib/server/tech-sync";

// NFR-02: the office's queue of field work recorded on a phone after the
// office changed that visit. The records are kept whatever is decided here;
// the decision is only what the visit should say.

export interface ReviewItem {
  id: string;
  kind: "completed_after_change" | "skipped_after_change";
  appointmentId: string;
  customerName: string;
  serviceType: string;
  timeZone: string;
  /** Who did the field work. */
  technicianName: string | null;
  details: ConflictDetails;
  /** Who the office had given the visit to at the time, if someone else. */
  officeTechnicianName: string | null;
  cancelReason: string | null;
  records: number;
}

export async function countOpenReview(m: MemberSession): Promise<number> {
  return withRls(m.claims, async (tx) => {
    const row = await tx.selectFrom("sync_conflicts").select(sql<number>`count(*)::int`.as("n")).where("resolved_at", "is", null).executeTakeFirst();
    return row?.n ?? 0;
  });
}

export async function listReview(m: MemberSession): Promise<ReviewItem[]> {
  return withRls(m.claims, async (tx) => {
    const rows = await tx
      .selectFrom("sync_conflicts as x")
      .innerJoin("appointments as a", (j) => j.onRef("a.id", "=", "x.appointment_id").onRef("a.tenant_id", "=", "x.tenant_id"))
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "x.technician_id").onRef("tech.tenant_id", "=", "x.tenant_id"))
      .select([
        "x.id", "x.kind", "x.details", "x.appointment_id", "a.tz", "a.cancel_reason", "c.display_name as customer_name", "t.name as service_type_name",
        "tech.display_name as technician_name",
        sql<number>`(select count(*)::int from public.applications ap where ap.appointment_id = a.id and ${isCurrentVersion("ap")})`.as("records"),
      ])
      .where("x.resolved_at", "is", null)
      .orderBy("x.created_at")
      .execute();
    const otherIds = [...new Set(rows.map((r) => (r.details as unknown as ConflictDetails).server_technician_id).filter((id): id is string => Boolean(id)))];
    const names = otherIds.length ? new Map((await tx.selectFrom("technicians").select(["id", "display_name"]).where("id", "in", otherIds).execute()).map((t) => [t.id, t.display_name])) : new Map<string, string>();
    return rows.map((r) => {
      const details = r.details as unknown as ConflictDetails;
      return {
        id: r.id,
        kind: r.kind as ReviewItem["kind"],
        appointmentId: r.appointment_id,
        customerName: r.customer_name,
        serviceType: r.service_type_name,
        timeZone: r.tz,
        technicianName: r.technician_name,
        details,
        officeTechnicianName: details.server_technician_id ? (names.get(details.server_technician_id) ?? null) : null,
        cancelReason: r.cancel_reason,
        records: r.records,
      };
    });
  });
}

export class ReviewGoneError extends Error {
  override name = "ReviewGoneError";
  constructor() {
    super("Someone has already decided this one.");
  }
}

/**
 * accept: the visit says what happened in the field (done, or skipped, by that
 * technician on that day). keep: the office's version stands. Either way the
 * item is closed with who decided and when.
 */
export async function resolveReview(m: MemberSession, input: { id: string; action: "accept" | "keep" }): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const item = await tx
      .selectFrom("sync_conflicts")
      .select(["id", "kind", "details", "appointment_id", "technician_id", "resolved_at"])
      .where("id", "=", input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!item || item.resolved_at) throw new ReviewGoneError();
    const details = item.details as unknown as ConflictDetails;
    if (input.action === "accept") {
      await sql`select 1 from public.appointments where id = ${item.appointment_id}::uuid for update`.execute(tx);
      const at = new Date(details.device_at);
      const visit = { technician_id: item.technician_id, local_date: details.device_date, sequence: null, cancel_reason: null, detached: true };
      await tx
        .updateTable("appointments")
        .set(
          item.kind === "completed_after_change"
            ? { ...visit, status: "completed", completed_at: at, arrived_at: sql`coalesce(arrived_at, ${at}::timestamptz)`, skip_reason: null }
            : { ...visit, status: "skipped", skip_reason: details.skip_reason ?? "Skipped in the field" },
        )
        .where("id", "=", item.appointment_id)
        .where("status", "not in", item.kind === "completed_after_change" ? ["completed"] : ["completed", "skipped"])
        .execute();
    }
    await tx
      .updateTable("sync_conflicts")
      .set({
        resolved_at: new Date(),
        resolved_by: m.userId,
        resolution: input.action === "accept" ? (item.kind === "completed_after_change" ? "Marked done as recorded in the field" : "Marked skipped as recorded in the field") : "Kept the office's version",
      })
      .where("id", "=", item.id)
      .execute();
  });
}
