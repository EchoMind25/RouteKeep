import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { addDays, type LocalDate } from "@/lib/domain/time";
import { LANE_STATUSES, stopOrder } from "@/lib/server/dispatch";

export interface DayStop {
  id: string;
  technicianId: string | null;
  sequence: number | null;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  durationMin: number;
  customerId: string;
  customerName: string;
  address: string;
  serviceType: string;
  isInitial: boolean;
  needsPin: boolean;
  version: number;
}

const stopColumns = [
  "a.id", "a.technician_id", "a.sequence", "a.status", "a.window_start", "a.window_end", "a.duration_min",
  "a.customer_id", "a.is_initial", "a.version", "a.local_date", "a.skip_reason", "a.cancel_reason",
  "c.display_name as customer_name", "t.name as service_type_name",
  sql<string>`p.address_line1 || ', ' || p.city`.as("address"),
  sql<boolean>`p.location is null or coalesce(p.geocode_confidence, 0) < 0.8 and p.location_confirmed_at is null`.as("needs_pin"),
] as const;

/** One day of work: every technician's stops plus the queue that must never be lost (FR-DSP-04). */
export async function getDay(m: MemberSession, date: LocalDate) {
  return withRls(m.claims, async (tx) => {
    const base = () =>
      tx
        .selectFrom("appointments as a")
        .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
        .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
        .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
        .select(stopColumns);

    const technicians = await tx
      .selectFrom("technicians")
      .select(["id", "display_name", "color_index"])
      .where("active", "=", true)
      .orderBy("display_name")
      .execute();

    const stops = await stopOrder(base().where("a.local_date", "=", date).where("a.status", "in", LANE_STATUSES)).execute();

    const queue = await base()
      .where((eb) =>
        eb.or([
          eb("a.status", "=", "unscheduled"),
          eb.and([eb("a.status", "in", ["skipped", "cancelled"]), eb("a.local_date", ">=", addDays(date, -14)), eb("a.local_date", "<=", addDays(date, 14))]),
          eb.and([eb("a.status", "=", "scheduled"), eb("a.technician_id", "is", null), eb("a.local_date", ">=", date), eb("a.local_date", "<=", addDays(date, 6))]),
        ]),
      )
      .orderBy("a.local_date", (ob) => ob.asc().nullsFirst())
      .limit(200)
      .execute();

    const toStop = (r: (typeof stops)[number]): DayStop & { localDate: string | null; reason: string | null } => ({
      id: r.id,
      technicianId: r.technician_id,
      sequence: r.sequence,
      status: r.status,
      windowStart: r.window_start?.slice(0, 5) ?? null,
      windowEnd: r.window_end?.slice(0, 5) ?? null,
      durationMin: r.duration_min,
      customerId: r.customer_id,
      customerName: r.customer_name,
      address: r.address,
      serviceType: r.service_type_name,
      isInitial: r.is_initial,
      needsPin: r.needs_pin,
      version: r.version,
      localDate: r.local_date,
      reason: r.skip_reason ?? r.cancel_reason,
    });

    return {
      technicians,
      stops: stops.map(toStop),
      queue: queue.map(toStop),
    };
  });
}

/** The signed-in technician's own day (online view until the offline app ships). */
export async function getMyDay(m: MemberSession, date: LocalDate) {
  return withRls(m.claims, async (tx) => {
    const tech = await tx.selectFrom("technicians").select(["id", "display_name"]).where("user_id", "=", m.userId).executeTakeFirst();
    if (!tech) return { technician: null, stops: [] };
    const stops = tx
      .selectFrom("appointments as a")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
      .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .select([
        "a.id", "a.sequence", "a.status", "a.window_start", "a.window_end", "c.display_name as customer_name",
        "p.address_line1", "p.city", "p.region", "p.postal_code", "p.access_notes", "t.name as service_type_name",
      ])
      .where("a.technician_id", "=", tech.id)
      .where("a.local_date", "=", date)
      .where("a.status", "in", LANE_STATUSES);
    return { technician: tech, stops: await stopOrder(stops).execute() };
  });
}
