import { parseMoneyToCents } from "@/lib/domain/money";
import { missingRecordFields, recordDeadline, requiresCustomerStatement, type ApplicationDraft } from "@/lib/domain/records";
import { instantToZoned, isLocalTime, zonedTimeToInstant, type LocalDate, type LocalTime } from "@/lib/domain/time";
import type { ApplicationEntry, Draft, SnapshotInfo } from "./client-store";
import type { Mutation, SnapshotMix, SnapshotProduct, SnapshotStop } from "./protocol";

// The stop flow's rules, free of React so they can be tested on their own
// (FR-TEC-03, FR-TEC-06, FR-TEC-07, FR-REC-05).

type CompleteMutation = Extract<Mutation, { kind: "complete" }>;

export function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function newDraft(stop: SnapshotStop, now: Date): Draft {
  return {
    appointmentId: stop.id,
    date: stop.date,
    step: "checklist",
    arrivedAt: now.toISOString(),
    checklist: Object.fromEntries(stop.checklist.map((label) => [label, false])),
    notes: "",
    applications: [],
    photos: [],
    signature: null,
    payment: { method: "invoice_later", amount: stop.priceCents ? (stop.priceCents / 100).toFixed(2) : "", checkNumber: "", key: key("pay") },
    completedAt: null,
    skippedAt: null,
    rejection: null,
    updatedAt: now.toISOString(),
  };
}

const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** A product line, prefilled from the last visit to this property, else from the product's defaults (FR-TEC-06). */
export function newApplication(product: SnapshotProduct, last: SnapshotMix | undefined, now: Date, timeZone: string): ApplicationEntry {
  return {
    key: key("app"),
    productId: product.id,
    mixRate: last ? text(last.mixRate) : text(product.defaultMixRate),
    mixUnit: last?.mixUnit ?? product.defaultMixUnit ?? "fl_oz_per_gal",
    totalAmount: last ? text(last.totalAmount) : "",
    amountUnit: last?.amountUnit ?? product.defaultAmountUnit ?? "gal",
    areaTreated: last ? text(last.areaTreated) : "",
    areaUnit: last?.areaUnit ?? "sq_ft",
    targetSites: last?.targetSites ?? [],
    targetPests: last?.targetPests ?? [],
    appliedTime: instantToZoned(now, timeZone).time,
    capturedAt: now.toISOString(),
    customerStatement: false,
    customerStatementAt: null,
  };
}

function positive(value: string): number | null {
  const n = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

export function appliedAt(entry: ApplicationEntry, date: string, timeZone: string): string | null {
  if (!isLocalTime(entry.appliedTime)) return null;
  return zonedTimeToInstant(date as LocalDate, entry.appliedTime as LocalTime, timeZone).toISOString();
}

/** The CR-01 view of one product line, filled the way the server will fill it. */
export function recordFor(entry: ApplicationEntry, stop: SnapshotStop, product: SnapshotProduct | undefined, info: SnapshotInfo): ApplicationDraft {
  return {
    productId: product?.id ?? null,
    technicianId: info.technician.id,
    customerName: stop.customerName,
    customerAddress: stop.address,
    applicationAddress: stop.address,
    businessName: info.business.name,
    businessAddress: info.business.address,
    businessLicenseNo: info.business.licenseNo,
    applicatorName: info.technician.name,
    applicatorLicenseNo: info.technician.licenseNo,
    productName: product?.name ?? null,
    productKind: product?.kind ?? null,
    epaRegNo: product?.epaRegNo ?? null,
    signalWord: product?.signalWord ?? null,
    restrictedUse: product?.restrictedUse ?? null,
    mixRate: positive(entry.mixRate),
    mixUnit: entry.mixUnit || null,
    totalAmount: positive(entry.totalAmount),
    amountUnit: entry.amountUnit || null,
    areaTreated: positive(entry.areaTreated),
    areaUnit: entry.areaUnit || null,
    targetSites: entry.targetSites,
    targetPests: entry.targetPests,
    appliedAt: appliedAt(entry, stop.date, info.business.timezone),
    customerStatementAt: entry.customerStatement ? (entry.customerStatementAt ?? entry.capturedAt) : null,
  };
}

export interface Missing {
  key: string;
  productName: string;
  fields: string[];
}

/** FR-TEC-07: exactly which field stops this stop from being completed, per product. */
export function missingFields(draft: Draft, stop: SnapshotStop, products: readonly SnapshotProduct[], info: SnapshotInfo): Missing[] {
  return draft.applications.flatMap((entry) => {
    const product = products.find((p) => p.id === entry.productId);
    const fields = missingRecordFields(recordFor(entry, stop, product, info));
    return fields.length ? [{ key: entry.key, productName: product?.name ?? "Unknown product", fields }] : [];
  });
}

export function needsStatement(product: SnapshotProduct | undefined): boolean {
  return Boolean(product) && requiresCustomerStatement({ restrictedUse: product!.restrictedUse, signalWord: product!.signalWord });
}

/** What is wrong with the payment as entered, in words, or null. */
export function paymentProblem(draft: Draft): string | null {
  if (draft.payment.method === "invoice_later") return null;
  let cents: number;
  try {
    cents = parseMoneyToCents(draft.payment.amount);
  } catch {
    return "Enter the amount collected";
  }
  if (cents <= 0) return "Enter the amount collected";
  if (draft.payment.method === "check" && !draft.payment.checkNumber.trim()) return "Enter the check number";
  return null;
}

/** The upload for a finished stop. Call only when missingFields and paymentProblem are clear. */
export function buildComplete(draft: Draft, stop: SnapshotStop, info: SnapshotInfo, now: Date): CompleteMutation {
  const payment: CompleteMutation["payment"] =
    draft.payment.method === "invoice_later"
      ? { method: "invoice_later" }
      : draft.payment.method === "cash"
        ? { method: "cash", key: draft.payment.key, amountCents: parseMoneyToCents(draft.payment.amount) }
        : { method: "check", key: draft.payment.key, amountCents: parseMoneyToCents(draft.payment.amount), checkNumber: draft.payment.checkNumber.trim() };
  return {
    kind: "complete",
    key: key("complete"),
    appointmentId: stop.id,
    date: draft.date,
    at: now.toISOString(),
    applications: draft.applications.map((entry) => ({
      key: entry.key,
      productId: entry.productId,
      mixRate: positive(entry.mixRate)!,
      mixUnit: entry.mixUnit as CompleteMutation["applications"][number]["mixUnit"],
      totalAmount: positive(entry.totalAmount)!,
      amountUnit: entry.amountUnit as CompleteMutation["applications"][number]["amountUnit"],
      areaTreated: positive(entry.areaTreated)!,
      areaUnit: entry.areaUnit as CompleteMutation["applications"][number]["areaUnit"],
      targetSites: entry.targetSites,
      targetPests: entry.targetPests,
      appliedAt: appliedAt(entry, stop.date, info.business.timezone)!,
      capturedAt: entry.capturedAt,
      customerStatementAt: entry.customerStatement ? (entry.customerStatementAt ?? entry.capturedAt) : null,
    })),
    checklist: Object.entries(draft.checklist).map(([label, done]) => ({ label, done })),
    notes: draft.notes.trim() || null,
    payment,
    signerName: draft.signature?.signerName.trim() || null,
  };
}

/** Photos and signature that go with the stop once it is finished (FR-TEC-09). */
export function attachmentKeys(draft: Draft): string[] {
  return [...draft.photos, ...(draft.signature ? [draft.signature.key] : [])];
}

export interface RecordDue {
  /** When the 24 hours run out. */
  due: Date;
  warn: boolean;
  overdue: boolean;
}

/**
 * CR-02: when this stop's records are due. Counted from the earliest moment
 * product can have gone down here (arrival, or an application time entered as
 * earlier than that), so the warning is never late. Null before anything has
 * started and once the stop is finished on this phone.
 */
export function recordDue(stop: SnapshotStop, draft: Draft | undefined, timeZone: string, now: Date): RecordDue | null {
  if (draft?.completedAt || draft?.skippedAt || stop.status === "completed") return null;
  if (!draft && stop.status !== "in_progress") return null;
  const starts = [draft?.arrivedAt, stop.status === "in_progress" ? stop.arrivedAt : null, ...(draft?.applications ?? []).map((entry) => appliedAt(entry, stop.date, timeZone))]
    .flatMap((t) => (t ? [new Date(t).getTime()] : []))
    .filter(Number.isFinite);
  if (!starts.length) return null;
  const { due, warn, overdue } = recordDeadline(new Date(Math.min(...starts)), now);
  return { due, warn, overdue };
}
