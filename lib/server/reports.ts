import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { addDays, parseLocalTime, zonedTimeToInstant } from "@/lib/domain/time";
import type { UsageFilters, UsageReport, UsageTotal } from "@/lib/reports/product-usage";
import { businessHeader } from "@/lib/server/business";
import { isCurrentVersion } from "@/lib/server/records";

const MIDNIGHT = parseLocalTime("00:00");
const num = (v: string | null) => (v === null ? null : Number(v));

/** FR-REC-06: application records in the range (business days, ENG-05), current versions only (FR-REC-03). */
/** `offset` pages through the rows (the export builds a month in parts); totals always cover the whole range. */
export async function productUsage(m: MemberSession, filters: UsageFilters, limit: number, offset = 0): Promise<UsageReport> {
  return withRls(m.claims, async (tx) => {
    const business = await businessHeader(tx);
    const tz = business.timezone;
    let base = tx
      .selectFrom("applications as a")
      .where("a.applied_at", ">=", zonedTimeToInstant(filters.from, MIDNIGHT, tz))
      .where("a.applied_at", "<", zonedTimeToInstant(addDays(filters.to, 1), MIDNIGHT, tz))
      // An amended record counts once, as amended: only the end of each chain.
      .where(isCurrentVersion("a"));
    if (filters.productId) base = base.where("a.product_id", "=", filters.productId);
    if (filters.technicianId) base = base.where("a.technician_id", "=", filters.technicianId);

    const groups = await base
      .select([
        "a.product_name",
        "a.epa_reg_no",
        "a.amount_unit",
        sql<boolean>`bool_or(coalesce(a.restricted_use, false))`.as("restricted"),
        sql<number>`count(*)::int`.as("n"),
        sql<string | null>`sum(a.total_amount)::text`.as("total"),
      ])
      .groupBy(["a.product_name", "a.epa_reg_no", "a.amount_unit"])
      .orderBy(sql`lower(coalesce(a.product_name, ''))`)
      .orderBy("a.product_name")
      .orderBy("a.epa_reg_no")
      .orderBy("a.amount_unit")
      .execute();
    const totals: UsageTotal[] = [];
    for (const g of groups) {
      const name = g.product_name ?? "Unnamed product";
      let total = totals.at(-1);
      if (!total || total.productName !== name || total.epaRegNo !== g.epa_reg_no) {
        total = { productName: name, epaRegNo: g.epa_reg_no, restrictedUse: false, applications: 0, amounts: [] };
        totals.push(total);
      }
      total.restrictedUse ||= g.restricted;
      total.applications += g.n;
      if (g.total !== null) total.amounts.push({ unit: g.amount_unit, total: Number(g.total), applications: g.n });
    }
    for (const t of totals) t.amounts.sort((a, b) => b.applications - a.applications || (a.unit ?? "").localeCompare(b.unit ?? ""));

    const rows = await base
      .select([
        "a.id", "a.appointment_id", "a.applied_at", "a.applicator_name", "a.applicator_license_no", "a.customer_name", "a.application_address",
        "a.product_name", "a.product_kind", "a.epa_reg_no", "a.signal_word", "a.restricted_use", "a.mix_rate", "a.mix_unit", "a.total_amount",
        "a.amount_unit", "a.area_treated", "a.area_unit", "a.target_sites", "a.target_pests", "a.customer_statement_at", "a.amended_from",
      ])
      .orderBy("a.applied_at")
      .orderBy("a.id")
      .limit(limit + 1)
      .offset(offset)
      .execute();

    const [product, technician] = await Promise.all([
      filters.productId ? tx.selectFrom("products").select(["name", "epa_reg_no"]).where("id", "=", filters.productId).executeTakeFirst() : undefined,
      filters.technicianId ? tx.selectFrom("technicians").select("display_name").where("id", "=", filters.technicianId).executeTakeFirst() : undefined,
    ]);

    return {
      filters,
      timeZone: tz,
      business: { name: business.name, licenseNo: business.licenseNo, address: business.address },
      productLabel: product ? `${product.name}${product.epa_reg_no ? `, EPA ${product.epa_reg_no}` : ""}` : null,
      technicianLabel: technician?.display_name ?? null,
      totals,
      count: totals.reduce((sum, t) => sum + t.applications, 0),
      rows: rows.slice(0, limit).map((r) => ({
        id: r.id,
        appointmentId: r.appointment_id,
        appliedAt: r.applied_at!,
        applicatorName: r.applicator_name,
        applicatorLicenseNo: r.applicator_license_no,
        customerName: r.customer_name,
        applicationAddress: r.application_address,
        productName: r.product_name ?? "Unnamed product",
        productKind: r.product_kind,
        epaRegNo: r.epa_reg_no,
        signalWord: r.signal_word,
        restrictedUse: Boolean(r.restricted_use),
        mixRate: num(r.mix_rate),
        mixUnit: r.mix_unit,
        totalAmount: num(r.total_amount),
        amountUnit: r.amount_unit,
        areaTreated: num(r.area_treated),
        areaUnit: r.area_unit,
        targetSites: r.target_sites,
        targetPests: r.target_pests,
        customerStatementAt: r.customer_statement_at,
        amendment: r.amended_from !== null,
      })),
      truncated: rows.length > limit,
    };
  });
}

/** What the report can be narrowed to: every product and technician, current ones first. */
export async function usageOptions(m: MemberSession) {
  return withRls(m.claims, async (tx) => ({
    products: await tx.selectFrom("products").select(["id", "name", "epa_reg_no", "active"]).orderBy("active", "desc").orderBy("name").execute(),
    technicians: await tx.selectFrom("technicians").select(["id", "display_name", "active"]).orderBy("active", "desc").orderBy("display_name").execute(),
  }));
}
