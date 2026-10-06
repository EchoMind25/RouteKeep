import "server-only";
import { sql, type Updateable } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls, type Tx } from "@/lib/db/rls";
import type { Appointments } from "@/lib/db/schema";

// Single-visit edits (FR-SUB-03 "this visit only", FR-SUB-04, FR-DSP-02).
// Every update carries the version the person saw; if someone else saved
// first, nothing changes and they are told to reload (ENG-07).

export class ConflictError extends Error {
  override name = "ConflictError";
  constructor() {
    super("Someone else changed this visit while you were looking at it. Reload to see the latest, then try again.");
  }
}

export async function getVisit(m: MemberSession, id: string) {
  return withRls(m.claims, async (tx) => {
    const visit = await tx
      .selectFrom("appointments as a")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
      .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "a.technician_id").onRef("tech.tenant_id", "=", "a.tenant_id"))
      .leftJoin("subscriptions as s", (j) => j.onRef("s.id", "=", "a.subscription_id").onRef("s.tenant_id", "=", "a.tenant_id"))
      .leftJoin("service_plans as sp", (j) => j.onRef("sp.id", "=", "s.plan_id").onRef("sp.tenant_id", "=", "s.tenant_id"))
      .select([
        "a.id", "a.version", "a.status", "a.local_date", "a.window_start", "a.window_end", "a.duration_min",
        "a.technician_id", "a.subscription_id", "a.occurrence_date", "a.is_initial", "a.detached", "a.price_cents",
        "a.skip_reason", "a.cancel_reason", "a.notes", "a.completed_at", "a.customer_id",
        "c.display_name as customer_name", "t.name as service_type_name", "tech.display_name as technician_name",
        "sp.name as plan_name",
        sql<string>`p.address_line1 || ', ' || p.city || ', ' || p.region || ' ' || p.postal_code`.as("address"),
      ])
      .where("a.id", "=", id)
      .executeTakeFirst();
    return visit ?? null;
  });
}

async function updateVisit(tx: Tx, id: string, version: number, values: Updateable<Appointments>) {
  const result = await tx
    .updateTable("appointments")
    .set(values)
    .where("id", "=", id)
    .where("version", "=", version)
    .where("status", "not in", ["completed", "in_progress"])
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) throw new ConflictError();
}

export interface RescheduleInput {
  id: string;
  version: number;
  localDate: string;
  technicianId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
}

/** "This visit only": move or reassign one visit. It stops following series edits. */
export async function rescheduleVisit(m: MemberSession, input: RescheduleInput) {
  await withRls(m.claims, async (tx) => {
    const current = await tx.selectFrom("appointments").select(["local_date", "technician_id"]).where("id", "=", input.id).executeTakeFirst();
    const movedRoute = current && (current.local_date !== input.localDate || current.technician_id !== input.technicianId);
    await updateVisit(tx, input.id, input.version, {
      status: "scheduled",
      local_date: input.localDate,
      technician_id: input.technicianId,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      detached: true,
      skip_reason: null,
      cancel_reason: null,
      // A stop number belongs to a route; moving to another day or person drops it (FR-DSP-05).
      ...(movedRoute ? { sequence: null } : {}),
    });
  });
}

export async function skipVisit(m: MemberSession, input: { id: string; version: number; reason: string }) {
  await withRls(m.claims, (tx) => updateVisit(tx, input.id, input.version, { status: "skipped", skip_reason: input.reason, sequence: null }));
}

export async function cancelVisit(m: MemberSession, input: { id: string; version: number; reason: string }) {
  await withRls(m.claims, (tx) => updateVisit(tx, input.id, input.version, { status: "cancelled", cancel_reason: input.reason, sequence: null }));
}

/** UX-03: undo a skip or cancel. */
export async function restoreVisit(m: MemberSession, input: { id: string; version: number }) {
  await withRls(m.claims, async (tx) => {
    const v = await tx.selectFrom("appointments").select(["local_date"]).where("id", "=", input.id).executeTakeFirst();
    await updateVisit(tx, input.id, input.version, {
      status: v?.local_date ? "scheduled" : "unscheduled",
      skip_reason: null,
      cancel_reason: null,
    });
  });
}

export interface OneOffInput {
  customerId: string;
  propertyId: string;
  serviceTypeId: string;
  localDate: string | null;
  technicianId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  priceCents: number | null;
  notes: string | null;
  clientKey: string;
}

/** FR-SUB-04: a visit with no plan behind it, e.g. a callback or a one-time job. No date puts it in the queue. */
export async function createOneOffVisit(m: MemberSession, input: OneOffInput): Promise<string> {
  return withRls(m.claims, async (tx) => {
    const type = await tx.selectFrom("service_types").select("default_duration_min").where("id", "=", input.serviceTypeId).executeTakeFirstOrThrow();
    const tenant = await tx.selectFrom("tenants").select("timezone").executeTakeFirstOrThrow();
    const row = await tx
      .insertInto("appointments")
      .values({
        customer_id: input.customerId,
        property_id: input.propertyId,
        service_type_id: input.serviceTypeId,
        status: input.localDate ? "scheduled" : "unscheduled",
        local_date: input.localDate,
        technician_id: input.technicianId,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        tz: tenant.timezone,
        duration_min: type.default_duration_min,
        price_cents: input.priceCents,
        notes: input.notes,
        client_key: input.clientKey,
      })
      // ENG-01: a double submit lands on the same row.
      .onConflict((oc) => oc.constraint("appointments_client_key").doUpdateSet({ updated_at: sql`appointments.updated_at` }))
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });
}
