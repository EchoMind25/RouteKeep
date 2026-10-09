import "server-only";
import { sql } from "kysely";
import { isEnabled } from "@/lib/flags";
import type { MemberSession } from "@/lib/auth/session";
import { withRls, type Tx } from "@/lib/db/rls";
import type { RouteStop } from "@/lib/domain/routing";
import { addDays, type LocalDate } from "@/lib/domain/time";
import { redactNote, type PlannerProblem } from "@/lib/routing/ai-planner";
import { estimateOptimizer, type RouteOptimizer, type RoutePlan } from "@/lib/providers/route-optimizer";

// Dispatch board (FR-DSP-01..06). Stop order is a route concern. Every write
// that changes a lane locks that technician's route row for the day, then
// compares the lane's current order with the order the dispatcher saw; if
// anything changed in between, nothing is written and the board reloads
// (FR-DSP-02, ENG-07). Comparing the order itself, not a counter, also
// catches changes made outside the board, such as a skip on the visit page.

export const DAY_START = "08:00";

/** Visits that occupy a place on a route. Skipped, cancelled and undated work lives in the queue (FR-DSP-04). */
export const LANE_STATUSES = ["scheduled", "in_progress", "completed"] as const;

export class RouteConflictError extends Error {
  override name = "RouteConflictError";
  constructor() {
    super("This route changed while you were working on it. The board has been refreshed; try again.");
  }
}

/**
 * D-07. Every setting resolves to the local estimate until the Google and
 * VROOM adapters exist; the preview says its times are estimates either way.
 */
export function optimizer(): RouteOptimizer {
  return estimateOptimizer;
}

export interface BoardStop {
  id: string;
  version: number;
  technicianId: string | null;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  durationMin: number;
  customerId: string;
  propertyId: string;
  customerName: string;
  address: string;
  serviceType: string;
  isInitial: boolean;
  needsPin: boolean;
  lat: number | null;
  lng: number | null;
}

export interface QueueStop extends BoardStop {
  localDate: string | null;
  reason: string | null;
}

export interface BoardRoute {
  technicianId: string;
  optimizedAt: string | null;
  canUndo: boolean;
  /** The lane matches the order the technician was given. */
  published: boolean;
  /** Published once, then changed: the technician has an older order. */
  changedSincePublish: boolean;
}

/** The stop numbers on the board, the map and the technician app all come from this order (FR-DSP-05). */
export function stopOrder<T extends { orderBy: (...args: never[]) => T }>(qb: T): T {
  const q = qb as unknown as {
    orderBy(col: string, mod: (ob: { asc(): { nullsLast(): unknown } }) => unknown): typeof q;
    orderBy(col: string, dir: "asc"): typeof q;
  };
  return q
    .orderBy("a.sequence", (ob) => ob.asc().nullsLast())
    .orderBy("a.window_start", (ob) => ob.asc().nullsLast())
    .orderBy("a.id", "asc") as unknown as T;
}

function boardStopQuery(tx: Tx) {
  return tx
    .selectFrom("appointments as a")
    .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
    .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
    .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
    .select([
      "a.id", "a.version", "a.technician_id", "a.status", "a.window_start", "a.window_end", "a.duration_min",
      "a.customer_id", "a.property_id", "a.is_initial", "a.local_date", "a.skip_reason", "a.cancel_reason",
      "c.display_name as customer_name", "t.name as service_type_name",
      sql<string>`p.address_line1 || ', ' || p.city`.as("address"),
      sql<boolean>`p.location is null or (coalesce(p.geocode_confidence, 0) < 0.8 and p.location_confirmed_at is null)`.as("needs_pin"),
      sql<number | null>`extensions.st_y(p.location::extensions.geometry)`.as("lat"),
      sql<number | null>`extensions.st_x(p.location::extensions.geometry)`.as("lng"),
    ]);
}

type StopRow = Awaited<ReturnType<ReturnType<typeof boardStopQuery>["execute"]>>[number];

function toBoardStop(r: StopRow): BoardStop {
  return {
    id: r.id,
    version: r.version,
    technicianId: r.technician_id,
    status: r.status,
    windowStart: r.window_start?.slice(0, 5) ?? null,
    windowEnd: r.window_end?.slice(0, 5) ?? null,
    durationMin: r.duration_min,
    customerId: r.customer_id,
    propertyId: r.property_id,
    customerName: r.customer_name,
    address: r.address,
    serviceType: r.service_type_name,
    isInitial: r.is_initial,
    needsPin: r.needs_pin,
    lat: r.lat,
    lng: r.lng,
  };
}

async function officeStart(tx: Tx) {
  const office = await tx
    .selectFrom("offices")
    .select([
      sql<number | null>`extensions.st_y(location::extensions.geometry)`.as("lat"),
      sql<number | null>`extensions.st_x(location::extensions.geometry)`.as("lng"),
    ])
    .where("is_primary", "=", true)
    .executeTakeFirst();
  return office?.lat != null && office.lng != null ? { lat: office.lat, lng: office.lng } : null;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function asIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

export async function getBoard(m: MemberSession, date: LocalDate) {
  return withRls(m.claims, async (tx) => {
    const rows = await stopOrder(boardStopQuery(tx).where("a.local_date", "=", date).where("a.status", "in", LANE_STATUSES)).execute();
    const stops = rows.map(toBoardStop);

    // Active technicians, plus anyone deactivated who still has work this day,
    // so no stop can fall off the board.
    const busy = [...new Set(stops.map((s) => s.technicianId).filter((id): id is string => id !== null))];
    const technicians = await tx
      .selectFrom("technicians")
      .select(["id", "display_name", "color_index", "active"])
      .where((eb) => (busy.length ? eb.or([eb("active", "=", true), eb("id", "in", busy)]) : eb("active", "=", true)))
      .orderBy("display_name")
      .execute();

    // FR-DSP-04: undated, skipped and cancelled work near this day, and
    // unassigned work on the coming days. Today's unassigned stops are
    // already in the Unassigned lane.
    const queueRows = await boardStopQuery(tx)
      .where((eb) =>
        eb.or([
          eb("a.status", "=", "unscheduled"),
          eb.and([eb("a.status", "in", ["skipped", "cancelled"]), eb("a.local_date", ">=", addDays(date, -14)), eb("a.local_date", "<=", addDays(date, 14))]),
          eb.and([eb("a.status", "=", "scheduled"), eb("a.technician_id", "is", null), eb("a.local_date", ">", date), eb("a.local_date", "<=", addDays(date, 6))]),
        ]),
      )
      .orderBy("a.local_date", (ob) => ob.asc().nullsFirst())
      .orderBy("a.id")
      .limit(200)
      .execute();
    const queue: QueueStop[] = queueRows.map((r) => ({ ...toBoardStop(r), localDate: r.local_date, reason: r.skip_reason ?? r.cancel_reason }));

    const routeRows = await tx
      .selectFrom("routes")
      .select(["technician_id", "optimized_at", "previous_order", "published_order"])
      .where("local_date", "=", date)
      .execute();

    const lane = (techId: string) => stops.filter((s) => s.technicianId === techId).map((s) => s.id);
    const routes = routeRows.map<BoardRoute>((r) => {
      const published = asIds(r.published_order);
      const current = lane(r.technician_id);
      return {
        technicianId: r.technician_id,
        optimizedAt: r.optimized_at?.toISOString() ?? null,
        canUndo: (asIds(r.previous_order)?.length ?? 0) > 0,
        published: published !== null && current.length > 0 && sameOrder(published, current),
        changedSincePublish: published !== null && !sameOrder(published, current),
      };
    });

    // FR-TEC-02: the newest "running late" each technician sent for this day.
    const late = isEnabled("runningLate")
      ? (await tx.selectFrom("tech_day_notices").select(["technician_id", "delay_min", "created_at"]).where("local_date", "=", date).where("kind", "=", "running_late").orderBy("created_at", "desc").execute())
          .filter((n, i, all) => all.findIndex((x) => x.technician_id === n.technician_id) === i)
          .map((n) => ({ technicianId: n.technician_id, delayMin: n.delay_min }))
      : [];

    return { technicians, stops, queue, routes, late, start: await officeStart(tx) };
  });
}

/**
 * Lock (creating if needed) each technician's route for the day, always in
 * the same order so two dispatchers moving stops between the same pair of
 * technicians cannot deadlock.
 */
async function lockRoutes(tx: Tx, technicianIds: readonly string[], date: LocalDate) {
  const ids = [...new Set(technicianIds)].sort();
  const locked = new Map<string, { id: string; previous_order: unknown }>();
  for (const technicianId of ids) {
    await tx
      .insertInto("routes")
      .values({ technician_id: technicianId, local_date: date, optimizer: "manual" })
      .onConflict((oc) => oc.columns(["tenant_id", "technician_id", "local_date"]).doNothing())
      .execute();
    const route = await tx
      .selectFrom("routes")
      .select(["id", "previous_order"])
      .where("technician_id", "=", technicianId)
      .where("local_date", "=", date)
      .forUpdate()
      .executeTakeFirstOrThrow();
    locked.set(technicianId, route);
  }
  return locked;
}

async function laneIds(tx: Tx, technicianId: string, date: LocalDate): Promise<string[]> {
  const rows = await stopOrder(
    tx
      .selectFrom("appointments as a")
      .select("a.id")
      .where("a.technician_id", "=", technicianId)
      .where("a.local_date", "=", date)
      .where("a.status", "in", LANE_STATUSES),
  ).execute();
  return rows.map((r) => r.id);
}

/** The lane must still be exactly what the dispatcher saw. */
async function expectLane(tx: Tx, technicianId: string, date: LocalDate, expected: readonly string[]): Promise<string[]> {
  const current = await laneIds(tx, technicianId, date);
  if (!sameOrder(current, expected)) throw new RouteConflictError();
  return current;
}

/** Number a lane 1..n. Only rows still in that lane are touched. */
async function writeSequence(tx: Tx, technicianId: string, date: LocalDate, ids: readonly string[]) {
  if (ids.length === 0) return;
  await sql`
    update public.appointments a set sequence = v.seq
    from (select unnest(${sql.val(ids)}::uuid[]) as id, generate_series(1, ${ids.length}) as seq) v
    where a.id = v.id and a.technician_id = ${technicianId}::uuid and a.local_date = ${date}::date
      and a.sequence is distinct from v.seq`.execute(tx);
}

/** A manual change ends the chance to undo the last optimize: undo would throw the change away. */
async function endUndo(tx: Tx, routeIds: readonly string[]) {
  if (routeIds.length === 0) return;
  await tx.updateTable("routes").set({ previous_order: null }).where("id", "in", routeIds).where("previous_order", "is not", null).execute();
}

export interface MoveInput {
  id: string;
  version: number;
  date: LocalDate;
  fromTechnicianId: string | null;
  toTechnicianId: string | null;
  toIndex: number;
  /** Lane orders as the dispatcher saw them; null for the unassigned lane, which has no order. */
  fromOrder: string[] | null;
  toOrder: string[] | null;
}

/**
 * FR-DSP-02: drag a stop within a lane, to another technician, or to the
 * unassigned lane. Both lanes are renumbered so stop numbers stay 1..n.
 */
export async function moveStop(m: MemberSession, input: MoveInput): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const techs = [input.fromTechnicianId, input.toTechnicianId].filter((t): t is string => t !== null);
    const routes = await lockRoutes(tx, techs, input.date);
    if (input.fromTechnicianId) await expectLane(tx, input.fromTechnicianId, input.date, input.fromOrder ?? []);
    if (input.toTechnicianId && input.toTechnicianId !== input.fromTechnicianId) await expectLane(tx, input.toTechnicianId, input.date, input.toOrder ?? []);

    // Only a scheduled stop moves; one in progress or done stays where it happened.
    const stop = tx
      .selectFrom("appointments")
      .select("id")
      .where("id", "=", input.id)
      .where("version", "=", input.version)
      .where("local_date", "=", input.date)
      .where("status", "=", "scheduled")
      .where("technician_id", input.fromTechnicianId === null ? "is" : "=", input.fromTechnicianId);
    if (!(await stop.forUpdate().executeTakeFirst())) throw new RouteConflictError();
    if (input.toTechnicianId !== input.fromTechnicianId) {
      await tx
        .updateTable("appointments")
        .set({ technician_id: input.toTechnicianId, detached: true, sequence: null })
        .where("id", "=", input.id)
        .execute();
    }

    if (input.fromTechnicianId && input.fromTechnicianId !== input.toTechnicianId) {
      await writeSequence(tx, input.fromTechnicianId, input.date, (input.fromOrder ?? []).filter((x) => x !== input.id));
    }
    if (input.toTechnicianId) {
      const lane = (input.toOrder ?? []).filter((x) => x !== input.id);
      lane.splice(Math.max(0, Math.min(input.toIndex, lane.length)), 0, input.id);
      await writeSequence(tx, input.toTechnicianId, input.date, lane);
    }
    await endUndo(tx, [...routes.values()].map((r) => r.id));
  });
}

/** FR-DSP-02: drag a stop onto another day. It keeps its technician and joins the end of that day's route. */
export async function moveStopToDay(m: MemberSession, input: { id: string; version: number; date: LocalDate; toDate: LocalDate }): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const current = await tx.selectFrom("appointments").select("technician_id").where("id", "=", input.id).executeTakeFirst();
    const routes = current?.technician_id ? await lockRoutes(tx, [current.technician_id], input.date) : new Map();
    const moved = await tx
      .updateTable("appointments")
      .set({ local_date: input.toDate, detached: true, sequence: null })
      .where("id", "=", input.id)
      .where("version", "=", input.version)
      .where("local_date", "=", input.date)
      .where("status", "=", "scheduled")
      .returning("technician_id")
      .executeTakeFirst();
    if (!moved) throw new RouteConflictError();
    if (moved.technician_id) {
      await writeSequence(tx, moved.technician_id, input.date, await laneIds(tx, moved.technician_id, input.date));
    }
    await endUndo(tx, [...routes.values()].map((r) => r.id));
  });
}

/**
 * FR-DSP-04 to FR-DSP-02: drag work out of the queue onto a route. Undated,
 * skipped and unassigned visits become scheduled stops on this day; the
 * visit then follows its own schedule, not the plan's (detached).
 */
export async function scheduleStop(
  m: MemberSession,
  input: { id: string; version: number; date: LocalDate; technicianId: string | null; toIndex: number; toOrder: string[] | null },
): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const routes = input.technicianId ? await lockRoutes(tx, [input.technicianId], input.date) : new Map();
    // A day target appends without an order to compare against.
    if (input.technicianId && input.toOrder) await expectLane(tx, input.technicianId, input.date, input.toOrder);
    const moved = await tx
      .updateTable("appointments")
      .set({
        status: "scheduled",
        local_date: input.date,
        technician_id: input.technicianId,
        detached: true,
        skip_reason: null,
        cancel_reason: null,
        sequence: null,
      })
      .where("id", "=", input.id)
      .where("version", "=", input.version)
      .where("status", "in", ["unscheduled", "skipped", "scheduled"])
      .executeTakeFirst();
    if (Number(moved.numUpdatedRows) !== 1) throw new RouteConflictError();
    if (input.technicianId) {
      const lane = input.toOrder ? [...input.toOrder] : (await laneIds(tx, input.technicianId, input.date)).filter((x) => x !== input.id);
      lane.splice(Math.max(0, Math.min(input.toIndex, lane.length)), 0, input.id);
      await writeSequence(tx, input.technicianId, input.date, lane);
    }
    await endUndo(tx, [...routes.values()].map((r) => r.id));
  });
}

async function laneStops(tx: Tx, technicianId: string, date: LocalDate): Promise<{ ids: string[]; stops: RouteStop[] }> {
  const rows = await stopOrder(
    tx
      .selectFrom("appointments as a")
      .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
      .select([
        "a.id", "a.duration_min", "a.window_start", "a.window_end",
        sql<number | null>`extensions.st_y(p.location::extensions.geometry)`.as("lat"),
        sql<number | null>`extensions.st_x(p.location::extensions.geometry)`.as("lng"),
      ])
      .where("a.technician_id", "=", technicianId)
      .where("a.local_date", "=", date)
      .where("a.status", "in", LANE_STATUSES),
  ).execute();
  return {
    ids: rows.map((r) => r.id),
    stops: rows
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        id: r.id,
        lat: r.lat!,
        lng: r.lng!,
        durationMin: r.duration_min,
        windowStart: r.window_start?.slice(0, 5) ?? null,
        windowEnd: r.window_end?.slice(0, 5) ?? null,
      })),
  };
}

/**
 * D-07 (revised): the lane as the AI planner needs it, read with the
 * dispatcher's own permissions. Notes are redacted here, before they are
 * stored or sent anywhere (NFR-08).
 */
export async function aiLaneProblem(tx: Tx, technicianId: string, date: LocalDate): Promise<{ expected: string[]; problem: PlannerProblem; unplaced: string[] }> {
  const rows = await stopOrder(
    tx
      .selectFrom("appointments as a")
      .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .select([
        "a.id", "a.duration_min", "a.window_start", "a.window_end", "a.notes", "p.access_notes", "t.name as service_type",
        sql<number | null>`extensions.st_y(p.location::extensions.geometry)`.as("lat"),
        sql<number | null>`extensions.st_x(p.location::extensions.geometry)`.as("lng"),
      ])
      .where("a.technician_id", "=", technicianId)
      .where("a.local_date", "=", date)
      .where("a.status", "in", LANE_STATUSES),
  ).execute();
  const placed = rows.filter((r) => r.lat !== null && r.lng !== null);
  const stops = placed.map((r) => ({
    id: r.id,
    lat: r.lat!,
    lng: r.lng!,
    durationMin: r.duration_min,
    windowStart: r.window_start?.slice(0, 5) ?? null,
    windowEnd: r.window_end?.slice(0, 5) ?? null,
    serviceType: r.service_type,
    note: redactNote([r.access_notes, r.notes].filter(Boolean).join(". ")),
  }));
  return {
    expected: rows.map((r) => r.id),
    problem: { start: await officeStart(tx), dayStart: DAY_START, stops, current: stops.map((s) => s.id) },
    unplaced: rows.filter((r) => r.lat === null || r.lng === null).map((r) => r.id),
  };
}

export interface OptimizePreview {
  technicianId: string;
  /** The whole lane as it stood for the preview; the commit is refused if it changed. */
  expected: string[];
  current: RoutePlan;
  proposed: RoutePlan;
  /** Stops without a usable pin keep their place at the end and are listed here. */
  unplaced: string[];
}

/** FR-DSP-03: a proposal only; nothing is written until the dispatcher commits it. */
export async function previewOptimize(m: MemberSession, technicianId: string, date: LocalDate): Promise<OptimizePreview> {
  return withRls(m.claims, async (tx) => {
    const { ids, stops } = await laneStops(tx, technicianId, date);
    const input = { start: await officeStart(tx), stops, dayStart: DAY_START };
    const placed = new Set(stops.map((s) => s.id));
    return {
      technicianId,
      expected: ids,
      current: await optimizer().measure(input),
      proposed: await optimizer().optimize(input),
      unplaced: ids.filter((id) => !placed.has(id)),
    };
  });
}

/** FR-DSP-03: commit a previewed order; the order before it is kept for one undo. */
export async function commitOptimize(
  m: MemberSession,
  input: { technicianId: string; date: LocalDate; order: string[]; expected: string[]; provider: string; stats: Record<string, number> },
) {
  await withRls(m.claims, async (tx) => {
    const route = (await lockRoutes(tx, [input.technicianId], input.date)).get(input.technicianId)!;
    const before = await expectLane(tx, input.technicianId, input.date, input.expected);
    const inLane = new Set(before);
    const proposed = input.order.filter((id) => inLane.has(id));
    const rest = before.filter((id) => !proposed.includes(id));
    await writeSequence(tx, input.technicianId, input.date, [...proposed, ...rest]);
    await tx
      .updateTable("routes")
      .set({
        previous_order: JSON.stringify(before),
        optimizer: input.provider === "estimate" ? "manual" : input.provider,
        optimized_at: new Date(),
        run_id: crypto.randomUUID(),
        stats: JSON.stringify(input.stats),
      })
      .where("id", "=", route.id)
      .execute();
  });
}

/** FR-DSP-03: undo the last commit. */
export async function undoOptimize(m: MemberSession, input: { technicianId: string; date: LocalDate; expected: string[] }) {
  await withRls(m.claims, async (tx) => {
    const route = (await lockRoutes(tx, [input.technicianId], input.date)).get(input.technicianId)!;
    const previous = asIds(route.previous_order) ?? [];
    if (previous.length === 0) throw new RouteConflictError();
    const lane = await expectLane(tx, input.technicianId, input.date, input.expected);
    const kept = previous.filter((id) => lane.includes(id));
    await writeSequence(tx, input.technicianId, input.date, [...kept, ...lane.filter((id) => !kept.includes(id))]);
    await tx.updateTable("routes").set({ previous_order: null, optimized_at: null }).where("id", "=", route.id).execute();
  });
}

/** FR-DSP-06: publishing records the order the technician gets and how many flagged stops the dispatcher accepted. */
export async function publishRoute(m: MemberSession, input: { technicianId: string; date: LocalDate; expected: string[]; flaggedStops: number }) {
  await withRls(m.claims, async (tx) => {
    const route = (await lockRoutes(tx, [input.technicianId], input.date)).get(input.technicianId)!;
    const lane = await expectLane(tx, input.technicianId, input.date, input.expected);
    if (lane.length === 0) throw new RouteConflictError();
    // Number the lane as published so the technician app shows the same numbers (FR-DSP-05).
    await writeSequence(tx, input.technicianId, input.date, lane);
    await tx
      .updateTable("routes")
      .set({ published_at: new Date(), published_by: m.userId, published_order: JSON.stringify(lane), flagged_stops: input.flaggedStops })
      .where("id", "=", route.id)
      .execute();
  });
}

export function nextDays(date: LocalDate, count = 6): LocalDate[] {
  return Array.from({ length: count }, (_, i) => addDays(date, i + 1));
}
