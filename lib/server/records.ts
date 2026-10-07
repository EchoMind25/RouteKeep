import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { formatAddress } from "@/lib/domain/contact";

// What was done at a visit, as the record shows it (FR-REC-01, FR-REC-02,
// CR-01, CR-03): the visit page and the PDF read the same thing.

export interface ServiceRecord {
  visit: {
    id: string;
    status: string;
    localDate: string | null;
    timeZone: string;
    arrivedAt: Date | null;
    completedAt: Date | null;
    techNotes: string | null;
    checklist: { label: string; done: boolean }[];
    signerName: string | null;
    customerName: string;
    address: string;
    serviceType: string;
    technicianName: string | null;
  };
  business: { name: string; licenseNo: string; address: string; state: string };
  applications: {
    id: string;
    productName: string;
    productKind: string | null;
    epaRegNo: string | null;
    signalWord: string | null;
    restrictedUse: boolean;
    mixRate: number | null;
    mixUnit: string | null;
    totalAmount: number | null;
    amountUnit: string | null;
    areaTreated: number | null;
    areaUnit: string | null;
    targetSites: string[];
    targetPests: string[];
    appliedAt: Date | null;
    recordedAt: Date;
    applicatorName: string | null;
    applicatorLicenseNo: string | null;
    customerStatementAt: Date | null;
    amendedFrom: string | null;
  }[];
  attachments: { id: string; kind: string; capturedAt: Date | null }[];
}

const num = (v: string | null) => (v === null ? null : Number(v));

export async function getServiceRecord(m: MemberSession, appointmentId: string): Promise<ServiceRecord | null> {
  return withRls(m.claims, async (tx) => {
    const v = await tx
      .selectFrom("appointments as a")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
      .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "a.technician_id").onRef("tech.tenant_id", "=", "a.tenant_id"))
      .select([
        "a.id", "a.status", "a.local_date", "a.tz", "a.arrived_at", "a.completed_at", "a.tech_notes", "a.checklist_results", "a.signer_name",
        "c.display_name as customer_name", "t.name as service_type_name", "tech.display_name as technician_name",
        "p.address_line1", "p.address_line2", "p.city", "p.region", "p.postal_code",
      ])
      .where("a.id", "=", appointmentId)
      .executeTakeFirst();
    if (!v) return null;
    const tenant = await tx.selectFrom("tenants").select(["name", "business_license_no", "state"]).executeTakeFirstOrThrow();
    const office = await tx
      .selectFrom("offices")
      .select(["address_line1", "address_line2", "city", "region", "postal_code"])
      .where("is_primary", "=", true)
      .executeTakeFirst();
    const applications = await tx
      .selectFrom("applications")
      .select([
        "id", "product_name", "product_kind", "epa_reg_no", "signal_word", "restricted_use", "mix_rate", "mix_unit", "total_amount", "amount_unit",
        "area_treated", "area_unit", "target_sites", "target_pests", "applied_at", "recorded_at", "applicator_name", "applicator_license_no",
        "customer_statement_at", "amended_from",
      ])
      .where("appointment_id", "=", appointmentId)
      .orderBy(sql`coalesce(applied_at, recorded_at)`)
      .execute();
    const attachments = await tx
      .selectFrom("attachments")
      .select(["id", "kind", "captured_at"])
      .where("owner_type", "=", "appointment")
      .where("owner_id", "=", appointmentId)
      .orderBy("captured_at")
      .execute();
    const checklist = Array.isArray(v.checklist_results)
      ? (v.checklist_results as { label?: unknown; done?: unknown }[]).flatMap((c) => (typeof c?.label === "string" ? [{ label: c.label, done: c.done === true }] : []))
      : [];
    return {
      visit: {
        id: v.id,
        status: v.status,
        localDate: v.local_date,
        timeZone: v.tz,
        arrivedAt: v.arrived_at,
        completedAt: v.completed_at,
        techNotes: v.tech_notes,
        checklist,
        signerName: v.signer_name,
        customerName: v.customer_name,
        address: formatAddress({ line1: v.address_line1, line2: v.address_line2, city: v.city, region: v.region, postalCode: v.postal_code }),
        serviceType: v.service_type_name,
        technicianName: v.technician_name,
      },
      business: {
        name: tenant.name,
        licenseNo: tenant.business_license_no,
        state: tenant.state,
        address: office ? formatAddress({ line1: office.address_line1, line2: office.address_line2, city: office.city, region: office.region, postalCode: office.postal_code }) : "",
      },
      applications: applications.map((a) => ({
        id: a.id,
        productName: a.product_name ?? "Unnamed product",
        productKind: a.product_kind,
        epaRegNo: a.epa_reg_no,
        signalWord: a.signal_word,
        restrictedUse: Boolean(a.restricted_use),
        mixRate: num(a.mix_rate),
        mixUnit: a.mix_unit,
        totalAmount: num(a.total_amount),
        amountUnit: a.amount_unit,
        areaTreated: num(a.area_treated),
        areaUnit: a.area_unit,
        targetSites: a.target_sites,
        targetPests: a.target_pests,
        appliedAt: a.applied_at,
        recordedAt: a.recorded_at,
        applicatorName: a.applicator_name,
        applicatorLicenseNo: a.applicator_license_no,
        customerStatementAt: a.customer_statement_at,
        amendedFrom: a.amended_from,
      })),
      attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, capturedAt: a.captured_at })),
    };
  });
}
