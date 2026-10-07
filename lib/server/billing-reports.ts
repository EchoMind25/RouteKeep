import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { AGING_BUCKETS, agingBucket, type AgingBucket } from "@/lib/domain/billing";
import { addDays, parseLocalDate, parseLocalTime, todayIn, zonedTimeToInstant, type LocalDate } from "@/lib/domain/time";
import { businessHeader } from "@/lib/server/business";

// FR-BIL-08, ENG-06: revenue, money owed and production, read from the ledger
// and the visits; nothing here keeps its own totals.

const MIDNIGHT = parseLocalTime("00:00");

export interface RevenueMonth {
  month: string;
  invoicedCents: number;
  collectedCents: number;
  creditedCents: number;
}

/** Month by month in the business's time zone: what was invoiced, collected and credited. */
export async function revenueByMonth(m: MemberSession, from: LocalDate, to: LocalDate): Promise<RevenueMonth[]> {
  return withRls(m.claims, async (tx) => {
    const { timezone } = await businessHeader(tx);
    const month = sql<string>`to_char(occurred_at at time zone ${timezone}, 'YYYY-MM')`;
    const rows = await tx
      .selectFrom("ledger_entries")
      .select([
        month.as("month"),
        sql<string>`coalesce(sum(amount_cents) filter (where type = 'invoice'), 0)::text`.as("invoiced"),
        sql<string>`coalesce(-sum(amount_cents) filter (where type = 'payment'), 0)::text`.as("collected"),
        sql<string>`coalesce(-sum(amount_cents) filter (where type = 'credit'), 0)::text`.as("credited"),
      ])
      .where("occurred_at", ">=", zonedTimeToInstant(from, MIDNIGHT, timezone))
      .where("occurred_at", "<", zonedTimeToInstant(addDays(to, 1), MIDNIGHT, timezone))
      // By position: the zone is a bound parameter, so repeating the
      // expression would not match the select list.
      .groupBy(sql`1`)
      .orderBy(sql`1`)
      .execute();
    return rows.map((r) => ({ month: r.month, invoicedCents: Number(r.invoiced), collectedCents: Number(r.collected), creditedCents: Number(r.credited) }));
  });
}

/** FR-BIL-08: everything still owed, by how late it is. */
export async function agingSummary(m: MemberSession): Promise<Record<AgingBucket, { invoices: number; cents: number }>> {
  return withRls(m.claims, async (tx) => {
    const today = todayIn(m.timezone);
    const rows = await tx
      .selectFrom("invoice_balances")
      .select(["due_date", "open_cents"])
      .where("status", "=", "open")
      .where("open_cents", ">", sql<number>`0`)
      .execute();
    const out = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { invoices: 0, cents: 0 }])) as Record<AgingBucket, { invoices: number; cents: number }>;
    for (const r of rows) {
      const bucket = r.due_date ? agingBucket(parseLocalDate(r.due_date), today) : "current";
      out[bucket].invoices += 1;
      out[bucket].cents += Number(r.open_cents);
    }
    return out;
  });
}

export interface ProductionRow {
  technicianId: string | null;
  technicianName: string;
  visits: number;
  valueCents: number;
}

/** FR-BIL-08: finished visits and their value, by the technician who did them, by visit date. */
export async function productionByTechnician(m: MemberSession, from: LocalDate, to: LocalDate): Promise<ProductionRow[]> {
  return withRls(m.claims, async (tx) => {
    const rows = await tx
      .selectFrom("appointments as a")
      .leftJoin("technicians as t", (j) => j.onRef("t.id", "=", "a.technician_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .select(["a.technician_id", "t.display_name", sql<number>`count(*)::int`.as("visits"), sql<string>`coalesce(sum(a.price_cents), 0)::text`.as("value")])
      .where("a.status", "=", "completed")
      .where("a.local_date", ">=", from)
      .where("a.local_date", "<=", to)
      .groupBy(["a.technician_id", "t.display_name"])
      .orderBy(sql`coalesce(sum(a.price_cents), 0)`, "desc")
      .execute();
    return rows.map((r) => ({ technicianId: r.technician_id, technicianName: r.display_name ?? "No technician", visits: r.visits, valueCents: Number(r.value) }));
  });
}
