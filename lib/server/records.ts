import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { pgConstraint, pgErrorCode, withRls } from "@/lib/db/rls";
import { formatAddress } from "@/lib/domain/contact";
import { missingRecordFields, RECORD_WARN_HOURS, recordDeadline, recordTiming, requiresCustomerStatement, type ProductKind, type SignalWord } from "@/lib/domain/records";
import { instantToZoned, zonedTimeToInstant, type LocalDate, type LocalTime } from "@/lib/domain/time";
import type { AmountUnit, AreaUnit, MixUnit } from "@/lib/domain/units";
import { businessHeader } from "@/lib/server/business";

// What was done at a visit, as the record shows it (FR-REC-01, FR-REC-02,
// CR-01, CR-03): the visit page and the PDF read the same thing.
//
// FR-REC-03: a record is never edited after the fact; a correction is a new
// row that amends it, and each row is amended at most once. The current
// version is the end of that chain: the row nothing amends.

/** SQL: the row under `alias` is the current version of its record (nothing amends it). */
export function isCurrentVersion(alias: string) {
  return sql<boolean>`not exists (select 1 from public.applications later where later.tenant_id = ${sql.ref(`${alias}.tenant_id`)} and later.amended_from = ${sql.ref(`${alias}.id`)})`;
}

export interface RecordVersion {
  id: string;
  productId: string | null;
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
  /** Why this version replaced the one before it; null for the first. */
  amendmentReason: string | null;
}

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
    /** CR-02: for a visit started but not finished, when its records are due. */
    recordDue: { due: Date; warn: boolean; overdue: boolean } | null;
    customerName: string;
    address: string;
    serviceType: string;
    technicianName: string | null;
  };
  business: { name: string; licenseNo: string; address: string; state: string };
  /** Current versions only, in the order applied. */
  applications: (RecordVersion & {
    /** Earlier versions, newest first (FR-REC-03). */
    history: RecordVersion[];
    /** CR-02, measured on the first version: a later correction does not change when the record was made. */
    timing: { madeAt: Date; hoursAfter: number; late: boolean } | null;
  })[];
  attachments: { id: string; kind: string; capturedAt: Date | null }[];
}

const num = (v: string | null) => (v === null ? null : Number(v));

const VERSION_COLUMNS = [
  "id", "product_id", "product_name", "product_kind", "epa_reg_no", "signal_word", "restricted_use", "mix_rate", "mix_unit", "total_amount",
  "amount_unit", "area_treated", "area_unit", "target_sites", "target_pests", "applied_at", "recorded_at", "applicator_name",
  "applicator_license_no", "customer_statement_at", "amended_from", "amendment_reason", "captured_at", "imported",
] as const;

type VersionRow = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  product_kind: string | null;
  epa_reg_no: string | null;
  signal_word: string | null;
  restricted_use: boolean | null;
  mix_rate: string | null;
  mix_unit: string | null;
  total_amount: string | null;
  amount_unit: string | null;
  area_treated: string | null;
  area_unit: string | null;
  target_sites: string[];
  target_pests: string[];
  applied_at: Date | null;
  recorded_at: Date;
  applicator_name: string | null;
  applicator_license_no: string | null;
  customer_statement_at: Date | null;
  amended_from: string | null;
  amendment_reason: string | null;
};

function toVersion(a: VersionRow): RecordVersion {
  return {
    id: a.id,
    productId: a.product_id,
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
    amendmentReason: a.amendment_reason,
  };
}

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
    const business = await businessHeader(tx);
    const rows = await tx
      .selectFrom("applications")
      .select(VERSION_COLUMNS)
      .where("appointment_id", "=", appointmentId)
      .orderBy(sql`coalesce(applied_at, recorded_at)`)
      .orderBy("recorded_at")
      .execute();
    // Chains: an amendment keeps its record's visit, so every version is here.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const amended = new Set(rows.flatMap((r) => (r.amended_from ? [r.amended_from] : [])));
    const applications = rows
      .filter((r) => !amended.has(r.id))
      .map((current) => {
        const history: (typeof rows)[number][] = [];
        for (let prev = current.amended_from ? byId.get(current.amended_from) : undefined; prev; prev = prev.amended_from ? byId.get(prev.amended_from) : undefined) history.push(prev);
        const first = history.at(-1) ?? current;
        return {
          ...toVersion(current),
          history: history.map(toVersion),
          timing: recordTiming({
            appliedAt: first.applied_at,
            capturedAt: first.captured_at,
            recordedAt: first.recorded_at,
            visitCompletedAt: v.completed_at,
            imported: first.imported,
            amendedFrom: null,
          }),
        };
      });
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
        recordDue: v.status === "in_progress" && v.arrived_at ? recordDeadline(v.arrived_at) : null,
        customerName: v.customer_name,
        address: formatAddress({ line1: v.address_line1, line2: v.address_line2, city: v.city, region: v.region, postalCode: v.postal_code }),
        serviceType: v.service_type_name,
        technicianName: v.technician_name,
      },
      business: { name: business.name, licenseNo: business.licenseNo, address: business.address, state: business.state },
      applications,
      attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, capturedAt: a.captured_at })),
    };
  });
}

export interface RecordDueVisit {
  id: string;
  customerName: string;
  technicianName: string | null;
  timeZone: string;
  due: Date;
  overdue: boolean;
}

/**
 * CR-02: visits a technician started more than 20 hours ago whose records
 * have not reached the office. Oldest first. The phone may hold a finished
 * record that has not uploaded yet, which is why the office is told too.
 */
export async function listRecordsDue(m: MemberSession, now: Date = new Date()): Promise<RecordDueVisit[]> {
  return withRls(m.claims, async (tx) => {
    const rows = await tx
      .selectFrom("appointments as a")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "a.technician_id").onRef("tech.tenant_id", "=", "a.tenant_id"))
      .select(["a.id", "a.arrived_at", "a.tz", "c.display_name as customer_name", "tech.display_name as technician_name"])
      .where("a.status", "=", "in_progress")
      .where("a.arrived_at", "<=", new Date(now.getTime() - RECORD_WARN_HOURS * 3_600_000))
      .orderBy("a.arrived_at")
      .limit(50)
      .execute();
    return rows.map((r) => {
      const { due, overdue } = recordDeadline(r.arrived_at!, now);
      return { id: r.id, customerName: r.customer_name, technicianName: r.technician_name, timeZone: r.tz, due, overdue };
    });
  });
}

// FR-REC-03: amendments -----------------------------------------------------------------

export interface AmendableRecord {
  record: RecordVersion;
  appointmentId: string | null;
  customerName: string | null;
  timeZone: string;
  /** Applied date and time on the business's clock, for the form. */
  applied: { date: LocalDate; time: LocalTime } | null;
  statement: { date: LocalDate; time: LocalTime } | null;
  /** False once someone has amended it: only the current version is amended. */
  current: boolean;
  products: { id: string; name: string; epaRegNo: string | null; kind: string; signalWord: string | null; restrictedUse: boolean; active: boolean }[];
}

export async function getAmendableRecord(m: MemberSession, recordId: string): Promise<AmendableRecord | null> {
  return withRls(m.claims, async (tx) => {
    const row = await tx
      .selectFrom("applications as x")
      .leftJoin("appointments as a", (j) => j.onRef("a.id", "=", "x.appointment_id").onRef("a.tenant_id", "=", "x.tenant_id"))
      .select([...VERSION_COLUMNS.map((c) => `x.${c}` as const), "x.appointment_id", "x.customer_name", "a.tz", isCurrentVersion("x").as("current")])
      .where("x.id", "=", recordId)
      .executeTakeFirst();
    if (!row) return null;
    const timeZone = row.tz ?? (await businessHeader(tx)).timezone;
    const products = await tx
      .selectFrom("products")
      .select(["id", "name", "epa_reg_no", "kind", "signal_word", "restricted_use", "active"])
      .orderBy("active", "desc")
      .orderBy("name")
      .execute();
    return {
      record: toVersion(row),
      appointmentId: row.appointment_id,
      customerName: row.customer_name,
      timeZone,
      applied: row.applied_at ? instantToZoned(row.applied_at, timeZone) : null,
      statement: row.customer_statement_at ? instantToZoned(row.customer_statement_at, timeZone) : null,
      current: row.current,
      products: products.map((p) => ({ id: p.id, name: p.name, epaRegNo: p.epa_reg_no, kind: p.kind, signalWord: p.signal_word, restrictedUse: p.restricted_use, active: p.active })),
    };
  });
}

export interface AmendInput {
  recordId: string;
  /** Client key (ENG-01): a second submit of the same form makes no second amendment. */
  key: string;
  productId: string;
  mixRate: number;
  mixUnit: MixUnit;
  totalAmount: number;
  amountUnit: AmountUnit;
  areaTreated: number;
  areaUnit: AreaUnit;
  targetSites: string[];
  targetPests: string[];
  appliedDate: LocalDate;
  appliedTime: LocalTime;
  statementDate: LocalDate | null;
  statementTime: LocalTime | null;
  reason: string;
}

export class RecordGoneError extends Error {
  override name = "RecordGoneError";
  constructor() {
    super("This record is no longer on file.");
  }
}

/** Someone amended the record first; the newer version is what to amend now. */
export class AlreadyAmendedError extends Error {
  override name = "AlreadyAmendedError";
  constructor() {
    super("Someone amended this record while you were editing. Open the visit to see the latest version and amend that one.");
  }
}

/** The amendment would leave the record incomplete (CR-01, FR-REC-05); `field` names the form field. */
export class AmendmentInvalidError extends Error {
  override name = "AmendmentInvalidError";
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

/**
 * FR-REC-03: a correction is a new row linked to the record it corrects; the
 * original stays as it was, and the insert is audited by the database (CR-12).
 * Who applied it, for whom and where stay as recorded; what can change is
 * what was applied and when.
 */
export async function amendRecord(m: MemberSession, input: AmendInput): Promise<{ id: string; appointmentId: string | null }> {
  try {
    return await withRls(m.claims, async (tx) => {
      const original = await tx.selectFrom("applications").selectAll().where("id", "=", input.recordId).forUpdate().executeTakeFirst();
      if (!original) throw new RecordGoneError();
      const again = await tx.selectFrom("applications").select(["id", "appointment_id"]).where("client_key", "=", input.key).executeTakeFirst();
      if (again) return { id: again.id, appointmentId: again.appointment_id };
      const later = await tx.selectFrom("applications").select("id").where("amended_from", "=", original.id).executeTakeFirst();
      if (later) throw new AlreadyAmendedError();

      const product = await tx
        .selectFrom("products")
        .select(["id", "name", "kind", "epa_reg_no", "signal_word", "restricted_use"])
        .where("id", "=", input.productId)
        .executeTakeFirst();
      if (!product) throw new AmendmentInvalidError("Choose a product from the catalog.", "productId");
      const visit = original.appointment_id
        ? await tx.selectFrom("appointments").select("tz").where("id", "=", original.appointment_id).executeTakeFirst()
        : undefined;
      const tz = visit?.tz ?? (await businessHeader(tx)).timezone;
      const appliedAt = zonedTimeToInstant(input.appliedDate, input.appliedTime, tz);
      const statementAt = input.statementDate && input.statementTime ? zonedTimeToInstant(input.statementDate, input.statementTime, tz) : null;
      if (requiresCustomerStatement({ restrictedUse: product.restricted_use, signalWord: product.signal_word as SignalWord | null }) && !statementAt) {
        throw new AmendmentInvalidError("This product needs the customer's written statement before application. Enter when it was given.", "statementDate");
      }
      const missing = missingRecordFields({
        productId: product.id,
        technicianId: original.technician_id,
        customerName: original.customer_name,
        customerAddress: original.customer_address,
        applicationAddress: original.application_address,
        businessName: original.business_name,
        businessAddress: original.business_address,
        businessLicenseNo: original.business_license_no,
        applicatorName: original.applicator_name,
        applicatorLicenseNo: original.applicator_license_no,
        productName: product.name,
        productKind: product.kind as ProductKind,
        epaRegNo: product.epa_reg_no,
        signalWord: product.signal_word as SignalWord | null,
        restrictedUse: product.restricted_use,
        mixRate: input.mixRate,
        mixUnit: input.mixUnit,
        totalAmount: input.totalAmount,
        amountUnit: input.amountUnit,
        areaTreated: input.areaTreated,
        areaUnit: input.areaUnit,
        targetSites: input.targetSites,
        targetPests: input.targetPests,
        appliedAt: appliedAt.toISOString(),
        customerStatementAt: statementAt?.toISOString() ?? null,
      });
      if (missing.length) throw new AmendmentInvalidError(`The record would be missing: ${missing.join(", ")}.`, "form");

      const inserted = await tx
        .insertInto("applications")
        .values({
          appointment_id: original.appointment_id,
          product_id: product.id,
          technician_id: original.technician_id,
          customer_name: original.customer_name,
          customer_address: original.customer_address,
          application_address: original.application_address,
          business_name: original.business_name,
          business_address: original.business_address,
          business_license_no: original.business_license_no,
          applicator_name: original.applicator_name,
          applicator_license_no: original.applicator_license_no,
          product_name: product.name,
          product_kind: product.kind,
          epa_reg_no: product.epa_reg_no,
          signal_word: product.signal_word,
          restricted_use: product.restricted_use,
          mix_rate: String(input.mixRate),
          mix_unit: input.mixUnit,
          total_amount: String(input.totalAmount),
          amount_unit: input.amountUnit,
          area_treated: String(input.areaTreated),
          area_unit: input.areaUnit,
          target_sites: input.targetSites,
          target_pests: input.targetPests,
          applied_at: appliedAt,
          customer_statement_at: statementAt,
          state_template: original.state_template,
          amended_from: original.id,
          amendment_reason: input.reason,
          client_key: input.key,
        })
        .returning(["id", "appointment_id"])
        .executeTakeFirstOrThrow();
      return { id: inserted.id, appointmentId: inserted.appointment_id };
    });
  } catch (error) {
    // Two people amending the same record at once: the second loses the race.
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "applications_one_amendment") throw new AlreadyAmendedError();
    throw error;
  }
}
