import "server-only";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import type { CommissionRule } from "@/lib/domain/commission";
import { addDays, parseLocalTime, zonedTimeToInstant, type LocalDate } from "@/lib/domain/time";
import { businessHeader } from "@/lib/server/business";

// FR-SAL-01..04: technicians add customers and earn a commission on each.
// Amounts are worked out by the database at the sale (app.record_sale_commission);
// this module reads them and records the office's decisions.

export interface SalesSettings extends CommissionRule {
  enabled: boolean;
}

export async function getSalesSettings(m: MemberSession): Promise<SalesSettings> {
  return withRls(m.claims, async (tx) => {
    const t = await tx.selectFrom("tenants").select(["tech_sales_enabled", "commission_flat_cents", "commission_pct"]).executeTakeFirstOrThrow();
    return { enabled: t.tech_sales_enabled, flatCents: t.commission_flat_cents, pct: Number(t.commission_pct) };
  });
}

export async function updateSalesSettings(m: MemberSession, input: SalesSettings): Promise<void> {
  await withRls(m.claims, async (tx) => {
    await tx
      .updateTable("tenants")
      .set({ tech_sales_enabled: input.enabled, commission_flat_cents: input.flatCents, commission_pct: String(input.pct) })
      .where("id", "=", m.tenantId)
      .execute();
  });
}

/** The signed-in member's technician profile, if they have an active one. */
export async function myTechnician(m: MemberSession): Promise<{ id: string; name: string } | null> {
  return withRls(m.claims, async (tx) => {
    const t = await tx.selectFrom("technicians").select(["id", "display_name"]).where("user_id", "=", m.userId).where("active", "=", true).executeTakeFirst();
    return t ? { id: t.id, name: t.display_name } : null;
  });
}

export interface CommissionRow {
  id: string;
  version: number;
  createdAt: Date;
  technicianId: string;
  technicianName: string;
  customerId: string;
  customerName: string;
  planName: string | null;
  basisCents: number;
  flatCents: number;
  pct: number;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "void";
  note: string | null;
  decidedAt: Date | null;
}

export interface CommissionFilters {
  from: LocalDate;
  to: LocalDate;
  technicianId: string | null;
  status: CommissionRow["status"] | null;
}

const MIDNIGHT = parseLocalTime("00:00");

/**
 * FR-SAL-04: sales in a range of business days, newest first. A technician
 * sees only their own (the database enforces it), the office everyone's.
 */
export async function listCommissions(m: MemberSession, filters: CommissionFilters, limit = 1000): Promise<{ rows: CommissionRow[]; timeZone: string; truncated: boolean }> {
  return withRls(m.claims, async (tx) => {
    const { timezone } = await businessHeader(tx);
    let q = tx
      .selectFrom("commissions as k")
      .innerJoin("technicians as t", (j) => j.onRef("t.id", "=", "k.technician_id").onRef("t.tenant_id", "=", "k.tenant_id"))
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "k.customer_id").onRef("c.tenant_id", "=", "k.tenant_id"))
      .leftJoin("subscriptions as s", (j) => j.onRef("s.id", "=", "k.subscription_id").onRef("s.tenant_id", "=", "k.tenant_id"))
      .leftJoin("service_plans as p", (j) => j.onRef("p.id", "=", "s.plan_id").onRef("p.tenant_id", "=", "s.tenant_id"))
      .select([
        "k.id", "k.version", "k.created_at", "k.technician_id", "t.display_name as technician_name", "k.customer_id", "c.display_name as customer_name",
        "p.name as plan_name", "k.basis_cents", "k.flat_cents", "k.pct", "k.amount_cents", "k.status", "k.note", "k.decided_at",
      ])
      .where("k.created_at", ">=", zonedTimeToInstant(filters.from, MIDNIGHT, timezone))
      .where("k.created_at", "<", zonedTimeToInstant(addDays(filters.to, 1), MIDNIGHT, timezone))
      .orderBy("k.created_at", "desc")
      .orderBy("k.id")
      .limit(limit + 1);
    if (filters.technicianId) q = q.where("k.technician_id", "=", filters.technicianId);
    if (filters.status) q = q.where("k.status", "=", filters.status);
    const rows = await q.execute();
    return {
      timeZone: timezone,
      truncated: rows.length > limit,
      rows: rows.slice(0, limit).map((r) => ({
        id: r.id,
        version: r.version,
        createdAt: r.created_at,
        technicianId: r.technician_id,
        technicianName: r.technician_name,
        customerId: r.customer_id,
        customerName: r.customer_name,
        planName: r.plan_name,
        basisCents: r.basis_cents,
        flatCents: r.flat_cents,
        pct: Number(r.pct),
        amountCents: r.amount_cents,
        status: r.status as CommissionRow["status"],
        note: r.note,
        decidedAt: r.decided_at,
      })),
    };
  });
}

export class CommissionChangedError extends Error {
  override name = "CommissionChangedError";
  constructor() {
    super("Someone else changed this commission. The list now shows where it stands.");
  }
}

/** FR-SAL-03: approve, mark paid, put back to waiting, or void (with a reason). Version-checked (ENG-07). */
export async function decideCommission(
  m: MemberSession,
  input: { id: string; version: number; status: "approved" | "paid" | "pending" | "void"; note: string | null },
): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const updated = await tx
      .updateTable("commissions")
      .set({ status: input.status, ...(input.note !== null ? { note: input.note } : {}) })
      .where("id", "=", input.id)
      .where("version", "=", input.version)
      .returning("id")
      .executeTakeFirst();
    if (!updated) throw new CommissionChangedError();
  });
}

/** The sale behind a customer, for the customer page. */
export async function saleFor(m: MemberSession, customerId: string): Promise<{ technicianName: string; amountCents: number | null; status: string | null } | null> {
  return withRls(m.claims, async (tx) => {
    const row = await tx
      .selectFrom("customers as c")
      .innerJoin("technicians as t", (j) => j.onRef("t.id", "=", "c.sold_by_technician_id").onRef("t.tenant_id", "=", "c.tenant_id"))
      .leftJoin("commissions as k", (j) => j.onRef("k.customer_id", "=", "c.id").onRef("k.tenant_id", "=", "c.tenant_id"))
      .select(["t.display_name", "k.amount_cents", "k.status"])
      .where("c.id", "=", customerId)
      .executeTakeFirst();
    return row ? { technicianName: row.display_name, amountCents: row.amount_cents, status: row.status } : null;
  });
}

/** Totals by status, for the report's summary. */
export function commissionTotals(rows: CommissionRow[]): Record<CommissionRow["status"], { count: number; cents: number }> {
  const out = { pending: { count: 0, cents: 0 }, approved: { count: 0, cents: 0 }, paid: { count: 0, cents: 0 }, void: { count: 0, cents: 0 } };
  for (const r of rows) {
    out[r.status].count += 1;
    out[r.status].cents += r.amountCents;
  }
  return out;
}

