import { z } from "zod";
import { AMOUNT_UNITS, AREA_UNITS, MIX_UNITS, type AmountUnit } from "@/lib/domain/units";

// The technician app's sync contract (FR-TEC-01, FR-TEC-02, NFR-01, NFR-02).
// Shared by the device and the server, so both validate the same shapes.
//
// Down: a snapshot of today's and tomorrow's routes and everything a stop
// needs. Server wins on schedule fields, so a newer snapshot simply replaces
// the device's copy.
// Up: an ordered list of mutations, each with a client key. The server applies
// each one at most once (ENG-01) and answers per mutation, so one bad item
// never blocks the rest. Client wins on what was captured in the field: a
// record made against a visit the office has since changed is still stored,
// and the clash goes to the office's review queue.

export const SYNC_PROTOCOL = 1;

export interface SnapshotStop {
  id: string;
  version: number;
  date: string;
  /** Place in the day's route: the same number the board and the map show (FR-DSP-05). */
  number: number;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  durationMin: number;
  customerId: string;
  customerName: string;
  phone: string | null;
  /** The office's notes about the customer, e.g. "Prefers a call 30 minutes ahead". */
  customerNotes: string | null;
  propertyId: string;
  address: string;
  lat: number | null;
  lng: number | null;
  accessNotes: string | null;
  /** Notes on this visit from the office. */
  visitNotes: string | null;
  serviceTypeId: string;
  serviceType: string;
  checklist: string[];
  isInitial: boolean;
  priceCents: number | null;
  sqFt: number | null;
  lawnSqFt: number | null;
  arrivedAt: string | null;
  completedAt: string | null;
}

export interface SnapshotProduct {
  id: string;
  name: string;
  kind: "pesticide" | "minimum_risk" | "fertilizer" | "other";
  epaRegNo: string | null;
  signalWord: "caution" | "warning" | "danger" | "danger_poison" | null;
  restrictedUse: boolean;
  activeIngredients: string | null;
  defaultAmountUnit: string | null;
  defaultMixRate: number | null;
  defaultMixUnit: string | null;
}

/** What was used last time at a property, to prefill the next visit (FR-TEC-06). */
export interface SnapshotMix {
  productId: string;
  mixRate: number;
  mixUnit: string;
  totalAmount: number;
  amountUnit: string;
  areaTreated: number;
  areaUnit: string;
  targetSites: string[];
  targetPests: string[];
  appliedAt: string;
}

export interface Snapshot {
  protocol: typeof SYNC_PROTOCOL;
  generatedAt: string;
  today: string;
  days: string[];
  technician: { id: string; name: string; licenseNo: string; licenseExpiry: string };
  /** CR-01 and CR-03: on every record and every service record. */
  business: { name: string; address: string; licenseNo: string; state: string; timezone: string; whiteLabel?: boolean; accent?: string | null };
  stops: SnapshotStop[];
  products: SnapshotProduct[];
  /** Keyed by property id, newest first. */
  lastMixes: Record<string, SnapshotMix[]>;
  /** The technician's most used products in the last 90 days. */
  favorites: string[];
  /** FR-SAL-01: whether the owner lets technicians add customers. Missing on snapshots saved before it existed. */
  canSell?: boolean;
  /**
   * FR-INV-07: the resupply-day truck check. Present when the check is due, or
   * when today's count already exists (due false, so the app can show "done").
   * Missing on snapshots saved before it existed.
   */
  truckCheck?: {
    due: boolean;
    locationId: string;
    /** The local day the check is for (the business's today). */
    date: string;
    lines: { productId: string; name: string; unit: AmountUnit; expected: number | null }[];
  };
}

// Up ----------------------------------------------------------------------------------

const instant = z.iso.datetime({ offset: true });
/** FR-TEC-09: hosted functions refuse bodies over about 6 MB, so a photo stays under 5 MB (device and server agree). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const clientKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/, "client keys are letters, digits, _ and -");
const label = z.string().trim().min(1).max(80);

export const applicationInput = z.object({
  key: clientKey,
  productId: z.uuid(),
  mixRate: z.number().positive().max(1_000_000),
  mixUnit: z.enum(MIX_UNITS),
  totalAmount: z.number().positive().max(10_000_000),
  amountUnit: z.enum(AMOUNT_UNITS),
  areaTreated: z.number().positive().max(1_000_000_000),
  areaUnit: z.enum(AREA_UNITS),
  targetSites: z.array(label).min(1).max(20),
  targetPests: z.array(label).min(1).max(20),
  appliedAt: instant,
  /** When the device first saved it; the server sets recorded_at itself (DB-08). */
  capturedAt: instant,
  /** FR-REC-05: the customer's written statement before a restricted-use Danger product. */
  customerStatementAt: instant.nullable(),
});
export type ApplicationInput = z.infer<typeof applicationInput>;

export const paymentInput = z.discriminatedUnion("method", [
  z.object({ method: z.literal("invoice_later") }),
  z.object({ method: z.literal("cash"), key: clientKey, amountCents: z.number().int().positive().max(10_000_000) }),
  z.object({ method: z.literal("check"), key: clientKey, amountCents: z.number().int().positive().max(10_000_000), checkNumber: z.string().trim().min(1).max(40) }),
]);
export type PaymentInput = z.infer<typeof paymentInput>;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** `date` is the day the device had the visit on; if the office has moved it since, that is a conflict. */
const base = { key: clientKey, appointmentId: z.uuid(), date: localDate, at: instant };

export const stockCountLine = z.object({ productId: z.uuid(), qty: z.number().min(0).max(10_000_000), unit: z.enum(AMOUNT_UNITS) });

export const mutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("arrive"), ...base }),
  z.object({
    kind: z.literal("complete"),
    ...base,
    applications: z.array(applicationInput).max(30),
    checklist: z.array(z.object({ label: z.string().trim().min(1).max(200), done: z.boolean() })).max(50),
    notes: z.string().trim().max(4000).nullable(),
    payment: paymentInput,
    /** The name given with the signature, if the customer signed (FR-TEC-03). */
    signerName: z.string().trim().min(1).max(120).nullable().optional(),
  }),
  z.object({ kind: z.literal("skip"), ...base, reason: z.string().trim().min(1).max(500) }),
  // FR-MSG-01: tell the customer the technician is heading over.
  z.object({ kind: z.literal("on_the_way"), ...base }),
  // FR-TEC-02: behind for the rest of the day. About the day, not one visit, so no appointmentId.
  z.object({ kind: z.literal("running_late"), key: clientKey, date: localDate, at: instant, delayMin: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]) }),
  // FR-INV-07: the truck count on resupply day. About the truck, not a visit, so no appointmentId.
  z.object({ kind: z.literal("stock_count"), key: clientKey, date: localDate, at: instant, locationId: z.uuid(), lines: z.array(stockCountLine).min(1).max(200) }),
]);
export type Mutation = z.infer<typeof mutation>;

export const uploadRequest = z.object({
  protocol: z.literal(SYNC_PROTOCOL),
  mutations: z.array(mutation).min(1).max(50),
});

/**
 * The envelope alone. Each mutation is checked on its own so one malformed
 * item is answered "rejected" instead of failing the batch and being resent forever.
 */
export const uploadEnvelope = z.object({
  protocol: z.literal(SYNC_PROTOCOL),
  mutations: z.array(z.unknown()).min(1).max(50),
});

/**
 * applied: done. duplicate: already done earlier (a retry). conflict: kept,
 * and the office will review it. rejected: will never succeed as sent.
 * retry: the server failed for a reason of its own; send it again later.
 */
export type MutationStatus = "applied" | "duplicate" | "conflict" | "rejected" | "retry";

export interface MutationResult {
  key: string;
  status: MutationStatus;
  /** For people: why a mutation was refused, or what the office will review. */
  message?: string;
}

export interface UploadResponse {
  protocol: typeof SYNC_PROTOCOL;
  results: MutationResult[];
}
