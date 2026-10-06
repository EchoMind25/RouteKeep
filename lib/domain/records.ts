// Pesticide application records (CR-01, FR-REC-01, FR-TEC-07).
//
// The field list mirrors the cr01_complete CHECK constraint on
// public.applications: the stop flow uses it to say exactly which field is
// missing before the database would refuse the row (a unit test keeps the two
// in step).

export type ProductKind = "pesticide" | "minimum_risk" | "fertilizer" | "other";
export type SignalWord = "caution" | "warning" | "danger" | "danger_poison";

export interface ApplicationDraft {
  productId?: string | null;
  technicianId?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  applicationAddress?: string | null;
  businessName?: string | null;
  businessAddress?: string | null;
  businessLicenseNo?: string | null;
  applicatorName?: string | null;
  applicatorLicenseNo?: string | null;
  productName?: string | null;
  productKind?: ProductKind | null;
  epaRegNo?: string | null;
  signalWord?: SignalWord | null;
  restrictedUse?: boolean | null;
  mixRate?: number | null;
  mixUnit?: string | null;
  totalAmount?: number | null;
  amountUnit?: string | null;
  areaTreated?: number | null;
  areaUnit?: string | null;
  targetSites?: readonly string[] | null;
  targetPests?: readonly string[] | null;
  appliedAt?: Date | string | null;
  customerStatementAt?: Date | string | null;
}

/** Field, the DB column it lands in, and the words a technician sees. */
export const CR01_FIELDS = [
  { key: "productId", column: "product_id", label: "Product" },
  { key: "technicianId", column: "technician_id", label: "Applicator" },
  { key: "customerName", column: "customer_name", label: "Customer name" },
  { key: "customerAddress", column: "customer_address", label: "Customer address" },
  { key: "applicationAddress", column: "application_address", label: "Application address" },
  { key: "businessName", column: "business_name", label: "Business name" },
  { key: "businessAddress", column: "business_address", label: "Business address" },
  { key: "businessLicenseNo", column: "business_license_no", label: "Business license number" },
  { key: "applicatorName", column: "applicator_name", label: "Applicator name" },
  { key: "applicatorLicenseNo", column: "applicator_license_no", label: "Applicator license number" },
  { key: "productName", column: "product_name", label: "Product brand name" },
  { key: "productKind", column: "product_kind", label: "Product type" },
  { key: "mixRate", column: "mix_rate", label: "Mix rate" },
  { key: "mixUnit", column: "mix_unit", label: "Mix rate unit" },
  { key: "totalAmount", column: "total_amount", label: "Total amount applied" },
  { key: "amountUnit", column: "amount_unit", label: "Amount unit" },
  { key: "areaTreated", column: "area_treated", label: "Area treated" },
  { key: "areaUnit", column: "area_unit", label: "Area unit" },
  { key: "targetSites", column: "target_sites", label: "Target sites" },
  { key: "targetPests", column: "target_pests", label: "Target pests" },
  { key: "appliedAt", column: "applied_at", label: "Date and time applied" },
] as const satisfies readonly { key: keyof ApplicationDraft; column: string; label: string }[];

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((v) => typeof v === "string" && v.trim().length > 0);
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

/** Labels of every field still missing, in the order the stop flow asks for them. */
export function missingRecordFields(draft: ApplicationDraft): string[] {
  const missing: string[] = CR01_FIELDS.filter((f) => !present(draft[f.key])).map((f) => f.label);
  if (draft.productKind === "pesticide" && !present(draft.epaRegNo)) {
    missing.push("EPA registration number");
  }
  if (requiresCustomerStatement(draft) && !present(draft.customerStatementAt)) {
    missing.push("Customer statement (restricted-use Danger product)");
  }
  return missing;
}

/** FR-REC-05: restricted-use products with a Danger signal word. */
export function requiresCustomerStatement(draft: Pick<ApplicationDraft, "restrictedUse" | "signalWord">): boolean {
  return Boolean(draft.restrictedUse) && (draft.signalWord === "danger" || draft.signalWord === "danger_poison");
}

/** CR-02: hours left to record an application, and whether to warn (20 h). */
export function recordDeadline(appliedAt: Date, now: Date = new Date()): { hoursLeft: number; warn: boolean; overdue: boolean } {
  const hoursLeft = 24 - (now.getTime() - appliedAt.getTime()) / 3_600_000;
  return { hoursLeft, warn: hoursLeft <= 4 && hoursLeft > 0, overdue: hoursLeft <= 0 };
}

/** DB-08 mirror: may this record still be edited in place? */
export function isRecordEditable(recordedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - recordedAt.getTime() < 24 * 3_600_000;
}
