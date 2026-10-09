import "server-only";
import { sql, type Insertable } from "kysely";
import type { Tx } from "@/lib/db/rls";
import type { Appointments } from "@/lib/db/schema";
import { planGeneration, type SubscriptionForGeneration } from "@/lib/domain/generation";
import { parseLocalDate, parseLocalTime, todayIn } from "@/lib/domain/time";

// FR-SUB-02. Runs inside whatever transaction the caller opened: withRls when a
// CSR sells a plan (they see the visits immediately), withServiceRole in the
// nightly job. Inserts are idempotent on (tenant_id, subscription_id,
// occurrence_date), so overlapping runs cannot double-book.

/** FR-SUB-02: rows per insert statement. */
const INSERT_CHUNK = 2000;

export interface GenerationResult {
  subscriptions: number;
  created: number;
}

export async function generateVisits(
  tx: Tx,
  tenantId: string,
  options: { subscriptionIds?: string[]; now?: Date; limit?: number; afterId?: string } = {},
): Promise<GenerationResult & { lastId: string | null }> {
  const tenant = await tx.selectFrom("tenants").select("timezone").where("id", "=", tenantId).executeTakeFirstOrThrow();
  const today = todayIn(tenant.timezone, options.now);

  // A pause with an end date ends by itself (FR-SUB-03).
  let ended = tx
    .updateTable("subscriptions")
    .set({ status: "active", paused_from: null, paused_until: null, pause_reason: null })
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "paused")
    .where("paused_until", "<", today);
  if (options.subscriptionIds) ended = ended.where("id", "in", options.subscriptionIds.length ? options.subscriptionIds : ["00000000-0000-0000-0000-000000000000"]);
  await ended.execute();

  let query = tx
    .selectFrom("subscriptions")
    .select([
      "id", "customer_id", "property_id", "service_type_id", "status", "start_date", "rrule",
      "price_cents", "initial_price_cents", "duration_min", "generated_through", "paused_from",
      "paused_until", "preferred_technician_id", "preferred_window_start", "preferred_window_end",
    ])
    .where("tenant_id", "=", tenantId)
    .where("status", "<>", "cancelled")
    .orderBy("id");
  if (options.subscriptionIds) {
    if (options.subscriptionIds.length === 0) return { subscriptions: 0, created: 0, lastId: null };
    query = query.where("id", "in", options.subscriptionIds);
  }
  if (options.afterId) query = query.where("id", ">", options.afterId);
  if (options.limit) query = query.limit(options.limit);
  const subs = await query.execute();

  const rows: Insertable<Appointments>[] = [];
  const advanced: { id: string; through: string }[] = [];

  for (const s of subs) {
    const input: SubscriptionForGeneration = {
      id: s.id,
      status: s.status as SubscriptionForGeneration["status"],
      startDate: parseLocalDate(s.start_date),
      rrule: s.rrule,
      priceCents: s.price_cents,
      initialPriceCents: s.initial_price_cents,
      durationMin: s.duration_min,
      generatedThrough: s.generated_through ? parseLocalDate(s.generated_through) : null,
      pausedFrom: s.paused_from ? parseLocalDate(s.paused_from) : null,
      pausedUntil: s.paused_until ? parseLocalDate(s.paused_until) : null,
      preferredTechnicianId: s.preferred_technician_id,
      preferredWindowStart: s.preferred_window_start ? parseLocalTime(s.preferred_window_start) : null,
      preferredWindowEnd: s.preferred_window_end ? parseLocalTime(s.preferred_window_end) : null,
    };
    const plan = planGeneration(input, today);
    for (const v of plan.visits) {
      rows.push({
        tenant_id: tenantId,
        customer_id: s.customer_id,
        property_id: s.property_id,
        subscription_id: s.id,
        service_type_id: s.service_type_id,
        technician_id: v.technicianId,
        local_date: v.localDate,
        window_start: v.windowStart,
        window_end: v.windowEnd,
        tz: tenant.timezone,
        duration_min: v.durationMin,
        occurrence_date: v.occurrenceDate,
        is_initial: v.isInitial,
        price_cents: v.priceCents,
      });
    }
    if (plan.generatedThrough && plan.generatedThrough !== s.generated_through) {
      advanced.push({ id: s.id, through: plan.generatedThrough });
    }
  }

  let created = 0;
  // FR-SUB-02: chunked, so one statement never carries tens of thousands of rows.
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const result = await tx
      .insertInto("appointments")
      .values(rows.slice(i, i + INSERT_CHUNK))
      .onConflict((oc) => oc.constraint("appointments_occurrence").doNothing())
      .executeTakeFirst();
    created += Number(result.numInsertedOrUpdatedRows ?? 0);
  }
  if (advanced.length > 0) {
    await sql`
      update public.subscriptions s
      set generated_through = v.through::date
      from (values ${sql.join(advanced.map((a) => sql`(${a.id}::uuid, ${a.through})`))}) as v(id, through)
      where s.tenant_id = ${tenantId} and s.id = v.id`.execute(tx);
  }
  return { subscriptions: subs.length, created, lastId: subs.at(-1)?.id ?? null };
}
