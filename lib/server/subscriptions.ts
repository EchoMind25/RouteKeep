import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls, type Tx } from "@/lib/db/rls";
import { addDays, parseLocalDate, todayIn } from "@/lib/domain/time";
import { generateVisits } from "./generation";
import { ConflictError } from "./visits";

// Series edits (FR-SUB-03): change all future visits, pause, resume, cancel.
// Generated visits that were never touched and have no records attached are
// removed and regenerated; visits someone arranged by hand (detached) are
// kept and, where the series ends, cancelled visibly instead of deleted.

export class PlanConflictError extends ConflictError {
  constructor() {
    super();
    this.message = "Someone else changed this plan while you were looking at it. Reload to see the latest, then try again.";
  }
}

async function bumpGuard(tx: Tx, id: string, version: number) {
  // Lock the row and confirm nobody saved since the form was opened.
  const row = await tx
    .selectFrom("subscriptions")
    .select(["id", "status", "paused_from", "paused_until", "start_date"])
    .where("id", "=", id)
    .where("version", "=", version)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new PlanConflictError();
  return row;
}

/** Future visits generated for this plan that nobody arranged by hand. */
function untouchedFuture(tx: Tx, subscriptionId: string, from: string) {
  return tx
    .deleteFrom("appointments")
    .where("subscription_id", "=", subscriptionId)
    .where("local_date", ">=", from)
    .where("status", "=", "scheduled")
    .where("detached", "=", false);
}

export async function getSubscription(m: MemberSession, id: string) {
  return withRls(m.claims, async (tx) => {
    const sub = await tx
      .selectFrom("subscriptions as s")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "s.customer_id").onRef("c.tenant_id", "=", "s.tenant_id"))
      .innerJoin("service_plans as p", (j) => j.onRef("p.id", "=", "s.plan_id").onRef("p.tenant_id", "=", "s.tenant_id"))
      .select([
        "s.id", "s.version", "s.status", "s.start_date", "s.rrule", "s.price_cents", "s.initial_price_cents", "s.duration_min",
        "s.preferred_technician_id", "s.preferred_window_start", "s.preferred_window_end", "s.paused_from", "s.paused_until",
        "s.pause_reason", "s.cancel_reason", "s.cancelled_at", "s.autopay", "s.customer_id",
        "c.display_name as customer_name", "p.name as plan_name",
      ])
      .where("s.id", "=", id)
      .executeTakeFirst();
    if (!sub) return null;
    const today = todayIn(m.timezone);
    const future = await tx
      .selectFrom("appointments")
      .select((eb) => [
        eb.fn.countAll<number>().as("total"),
        eb.fn.count<number>("id").filterWhere("detached", "=", true).as("detached"),
      ])
      .where("subscription_id", "=", id)
      .where("local_date", ">=", today)
      .where("status", "=", "scheduled")
      .executeTakeFirstOrThrow();
    return { ...sub, futureVisits: Number(future.total), futureDetached: Number(future.detached) };
  });
}

export interface SeriesChange {
  id: string;
  version: number;
  technicianId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  priceCents: number;
  durationMin: number;
}

/**
 * "This and all future visits": new defaults for the plan, applied to every
 * future visit that still follows the series. Hand-arranged visits keep their
 * own date, person and window. Changing how often requires a new plan, so
 * past occurrence dates never move.
 */
export async function changeSeries(m: MemberSession, input: SeriesChange): Promise<number> {
  const today = todayIn(m.timezone);
  return withRls(m.claims, async (tx) => {
    await bumpGuard(tx, input.id, input.version);
    await tx
      .updateTable("subscriptions")
      .set({
        preferred_technician_id: input.technicianId,
        preferred_window_start: input.windowStart,
        preferred_window_end: input.windowEnd,
        price_cents: input.priceCents,
        duration_min: input.durationMin,
      })
      .where("id", "=", input.id)
      .execute();
    const result = await tx
      .updateTable("appointments")
      .set({
        technician_id: input.technicianId,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        duration_min: input.durationMin,
        price_cents: sql<number>`case when is_initial then price_cents else ${input.priceCents}::integer end`,
        sequence: sql<number | null>`case when technician_id is distinct from ${input.technicianId}::uuid then null else sequence end`,
      })
      .where("subscription_id", "=", input.id)
      .where("local_date", ">=", today)
      .where("status", "=", "scheduled")
      .where("detached", "=", false)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  });
}

export async function pauseSubscription(m: MemberSession, input: { id: string; version: number; from: string; until: string | null; reason: string }) {
  return withRls(m.claims, async (tx) => {
    await bumpGuard(tx, input.id, input.version);
    // Untouched visits inside the pause go; hand-arranged ones stay for a person to decide.
    let remove = untouchedFuture(tx, input.id, input.from);
    if (input.until) remove = remove.where("local_date", "<=", input.until);
    const removed = await remove.executeTakeFirst();
    await tx
      .updateTable("subscriptions")
      .set({
        status: "paused",
        paused_from: input.from,
        paused_until: input.until,
        pause_reason: input.reason,
        generated_through: addDays(parseLocalDate(input.from), -1),
      })
      .where("id", "=", input.id)
      .execute();
    // A bounded pause resumes on its own: create the visits after it now.
    if (input.until) await generateVisits(tx, m.tenantId, { subscriptionIds: [input.id] });
    return Number(removed.numDeletedRows);
  });
}

export async function resumeSubscription(m: MemberSession, input: { id: string; version: number }) {
  const today = todayIn(m.timezone);
  return withRls(m.claims, async (tx) => {
    const row = await bumpGuard(tx, input.id, input.version);
    if (row.status !== "paused") throw new PlanConflictError();
    await tx
      .updateTable("subscriptions")
      .set({ status: "active", paused_from: null, paused_until: null, pause_reason: null, generated_through: addDays(today, -1) })
      .where("id", "=", input.id)
      .execute();
    return (await generateVisits(tx, m.tenantId, { subscriptionIds: [input.id] })).created;
  });
}

export async function cancelSubscription(m: MemberSession, input: { id: string; version: number; reason: string }) {
  const today = todayIn(m.timezone);
  return withRls(m.claims, async (tx) => {
    const row = await bumpGuard(tx, input.id, input.version);
    if (row.status === "cancelled") throw new PlanConflictError();
    const removed = await untouchedFuture(tx, input.id, today).executeTakeFirst();
    // Hand-arranged future visits were promised to someone: cancel them where the dispatcher will see it.
    const cancelled = await tx
      .updateTable("appointments")
      .set({ status: "cancelled", cancel_reason: `Plan cancelled: ${input.reason}`, sequence: null })
      .where("subscription_id", "=", input.id)
      .where("local_date", ">=", today)
      .where("status", "=", "scheduled")
      .executeTakeFirst();
    await tx
      .updateTable("subscriptions")
      .set({ status: "cancelled", cancelled_at: new Date(), cancel_reason: input.reason })
      .where("id", "=", input.id)
      .execute();
    return { removed: Number(removed.numDeletedRows), cancelled: Number(cancelled.numUpdatedRows) };
  });
}

/** UX-03: a cancelled plan can be reactivated; visits are regenerated from today. */
export async function reactivateSubscription(m: MemberSession, input: { id: string; version: number }) {
  const today = todayIn(m.timezone);
  return withRls(m.claims, async (tx) => {
    const row = await bumpGuard(tx, input.id, input.version);
    if (row.status !== "cancelled") throw new PlanConflictError();
    await tx
      .updateTable("subscriptions")
      .set({ status: "active", cancelled_at: null, cancel_reason: null, generated_through: addDays(today, -1) })
      .where("id", "=", input.id)
      .execute();
    return (await generateVisits(tx, m.tenantId, { subscriptionIds: [input.id] })).created;
  });
}
