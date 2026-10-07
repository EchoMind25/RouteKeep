import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls, type Tx } from "@/lib/db/rls";
import { formatAddress } from "@/lib/domain/contact";
import { missingRecordFields, type ApplicationDraft } from "@/lib/domain/records";
import { addDays, todayIn, type LocalDate } from "@/lib/domain/time";
import { LANE_STATUSES, stopOrder } from "@/lib/server/dispatch";
import {
  SYNC_PROTOCOL,
  type Mutation,
  type MutationResult,
  type Snapshot,
  type SnapshotMix,
  type SnapshotProduct,
  type SnapshotStop,
} from "@/lib/sync/protocol";

// Server side of the technician app's sync (FR-TEC-01, NFR-01, NFR-02).
// Everything runs as the signed-in technician under RLS; the technician a
// record belongs to always comes from the session, never from the device.

export class NotATechnicianError extends Error {
  override name = "NotATechnicianError";
  constructor() {
    super("This login is not linked to a technician. Ask the office to link it.");
  }
}

async function technicianFor(tx: Tx, userId: string) {
  return tx
    .selectFrom("technicians")
    .select(["id", "display_name", "applicator_license_no", "license_expiry"])
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

async function business(tx: Tx) {
  const tenant = await tx.selectFrom("tenants").select(["name", "business_license_no", "state", "timezone"]).executeTakeFirstOrThrow();
  const office = await tx
    .selectFrom("offices")
    .select(["address_line1", "address_line2", "city", "region", "postal_code"])
    .where("is_primary", "=", true)
    .executeTakeFirst();
  return {
    name: tenant.name,
    licenseNo: tenant.business_license_no,
    state: tenant.state,
    timezone: tenant.timezone,
    address: office ? formatAddress({ line1: office.address_line1, line2: office.address_line2, city: office.city, region: office.region, postalCode: office.postal_code }) : "",
  };
}

const num = (v: string | number | null) => (v === null ? null : Number(v));

/** FR-TEC-01: today's and tomorrow's routes with everything a stop needs, for one technician. */
export async function getTechSnapshot(m: MemberSession, now: Date = new Date()): Promise<Snapshot> {
  return withRls(m.claims, async (tx) => {
    const tech = await technicianFor(tx, m.userId);
    if (!tech) throw new NotATechnicianError();
    const today = todayIn(m.timezone, now);
    const days: LocalDate[] = [today, addDays(today, 1)];

    const rows = await stopOrder(
      tx
        .selectFrom("appointments as a")
        .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
        .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
        .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
        .select([
          "a.id", "a.version", "a.local_date", "a.status", "a.window_start", "a.window_end", "a.duration_min", "a.is_initial",
          "a.price_cents", "a.notes", "a.arrived_at", "a.completed_at", "a.customer_id", "a.property_id", "a.service_type_id",
          "c.display_name as customer_name", "c.phone", "c.notes as customer_notes",
          "p.address_line1", "p.address_line2", "p.city", "p.region", "p.postal_code", "p.access_notes", "p.sq_ft", "p.lawn_area_sq_ft",
          "t.name as service_type_name", "t.checklist",
          sql<number | null>`extensions.st_y(p.location::extensions.geometry)`.as("lat"),
          sql<number | null>`extensions.st_x(p.location::extensions.geometry)`.as("lng"),
        ])
        .where("a.technician_id", "=", tech.id)
        .where("a.local_date", "in", days)
        .where("a.status", "in", LANE_STATUSES)
        .orderBy("a.local_date"),
    ).execute();

    const counters = new Map<string, number>();
    const stops: SnapshotStop[] = rows.map((r) => {
      const n = (counters.get(r.local_date!) ?? 0) + 1;
      counters.set(r.local_date!, n);
      const checklist = Array.isArray(r.checklist) ? (r.checklist as { label?: unknown }[]).flatMap((i) => (typeof i?.label === "string" ? [i.label] : [])) : [];
      return {
        id: r.id,
        version: r.version,
        date: r.local_date!,
        number: n,
        status: r.status,
        windowStart: r.window_start?.slice(0, 5) ?? null,
        windowEnd: r.window_end?.slice(0, 5) ?? null,
        durationMin: r.duration_min,
        customerId: r.customer_id,
        customerName: r.customer_name,
        phone: r.phone,
        customerNotes: r.customer_notes,
        propertyId: r.property_id,
        address: formatAddress({ line1: r.address_line1, line2: r.address_line2, city: r.city, region: r.region, postalCode: r.postal_code }),
        lat: r.lat,
        lng: r.lng,
        accessNotes: r.access_notes,
        visitNotes: r.notes,
        serviceTypeId: r.service_type_id,
        serviceType: r.service_type_name,
        checklist,
        isInitial: r.is_initial,
        priceCents: r.price_cents,
        sqFt: r.sq_ft,
        lawnSqFt: r.lawn_area_sq_ft,
        arrivedAt: r.arrived_at?.toISOString() ?? null,
        completedAt: r.completed_at?.toISOString() ?? null,
      };
    });

    const products: SnapshotProduct[] = (
      await tx
        .selectFrom("products")
        .select(["id", "name", "kind", "epa_reg_no", "signal_word", "restricted_use", "active_ingredients", "default_amount_unit", "default_mix_rate", "default_mix_unit"])
        .where("active", "=", true)
        .orderBy(sql`lower(name)`)
        .execute()
    ).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind as SnapshotProduct["kind"],
      epaRegNo: p.epa_reg_no,
      signalWord: p.signal_word as SnapshotProduct["signalWord"],
      restrictedUse: p.restricted_use,
      activeIngredients: p.active_ingredients,
      defaultAmountUnit: p.default_amount_unit,
      defaultMixRate: num(p.default_mix_rate),
      defaultMixUnit: p.default_mix_unit,
    }));

    // FR-TEC-06: what was used at each property last time, newest first, one row per product.
    const propertyIds = [...new Set(stops.map((s) => s.propertyId))];
    const lastMixes: Record<string, SnapshotMix[]> = {};
    if (propertyIds.length) {
      const history = await tx
        .selectFrom("applications as x")
        .innerJoin("appointments as a", (j) => j.onRef("a.id", "=", "x.appointment_id").onRef("a.tenant_id", "=", "x.tenant_id"))
        .select([
          "a.property_id", "x.product_id", "x.mix_rate", "x.mix_unit", "x.total_amount", "x.amount_unit", "x.area_treated", "x.area_unit",
          "x.target_sites", "x.target_pests", "x.applied_at",
        ])
        .where("a.property_id", "in", propertyIds)
        .where("x.imported", "=", false)
        .where("x.amended_from", "is", null)
        .orderBy("x.applied_at", "desc")
        .limit(propertyIds.length * 12)
        .execute();
      for (const h of history) {
        if (!h.product_id || !h.mix_rate || !h.mix_unit || !h.total_amount || !h.amount_unit || !h.area_treated || !h.area_unit || !h.applied_at) continue;
        const list = (lastMixes[h.property_id] ??= []);
        if (list.length >= 5 || list.some((x) => x.productId === h.product_id)) continue;
        list.push({
          productId: h.product_id,
          mixRate: Number(h.mix_rate),
          mixUnit: h.mix_unit,
          totalAmount: Number(h.total_amount),
          amountUnit: h.amount_unit,
          areaTreated: Number(h.area_treated),
          areaUnit: h.area_unit,
          targetSites: h.target_sites,
          targetPests: h.target_pests,
          appliedAt: h.applied_at.toISOString(),
        });
      }
    }

    const favorites = (
      await tx
        .selectFrom("applications")
        .select(["product_id", sql<number>`count(*)::int`.as("uses")])
        .where("technician_id", "=", tech.id)
        .where("product_id", "is not", null)
        .where("applied_at", ">", sql<Date>`now() - interval '90 days'`)
        .groupBy("product_id")
        .orderBy("uses", "desc")
        .limit(6)
        .execute()
    ).flatMap((f) => (f.product_id ? [f.product_id] : []));

    return {
      protocol: SYNC_PROTOCOL,
      generatedAt: now.toISOString(),
      today,
      days,
      technician: { id: tech.id, name: tech.display_name, licenseNo: tech.applicator_license_no, licenseExpiry: tech.license_expiry },
      business: await business(tx),
      stops,
      products,
      lastMixes,
      favorites,
    };
  });
}

// Up ----------------------------------------------------------------------------------

/** Who a visit belongs to and where it stands, read under a row lock. */
async function lockVisit(tx: Tx, id: string) {
  await sql`select 1 from public.appointments where id = ${id}::uuid for update`.execute(tx);
  return tx
    .selectFrom("appointments as a")
    .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "a.customer_id").onRef("c.tenant_id", "=", "a.tenant_id"))
    .innerJoin("properties as p", (j) => j.onRef("p.id", "=", "a.property_id").onRef("p.tenant_id", "=", "a.tenant_id"))
    .select([
      "a.id", "a.status", "a.technician_id", "a.local_date", "a.customer_id",
      "c.display_name as customer_name", "c.billing_address_line1", "c.billing_address_line2", "c.billing_city", "c.billing_region", "c.billing_postal_code",
      "p.address_line1", "p.address_line2", "p.city", "p.region", "p.postal_code",
    ])
    .where("a.id", "=", id)
    .executeTakeFirst();
}

type Visit = NonNullable<Awaited<ReturnType<typeof lockVisit>>>;
const OPEN = ["scheduled", "in_progress"];

/** What the review screen shows: what the phone did, and what the office had (NFR-02). */
export interface ConflictDetails {
  device_at: string;
  device_date: string;
  server_status: string;
  server_technician_id: string | null;
  server_date: string | null;
  skip_reason?: string;
}

async function raiseConflict(
  tx: Tx,
  key: string,
  techId: string,
  visit: Visit,
  kind: "completed_after_change" | "skipped_after_change",
  mutation: { at: string; date: string; reason?: string },
) {
  const details: ConflictDetails = {
    device_at: mutation.at,
    device_date: mutation.date,
    server_status: visit.status,
    server_technician_id: visit.technician_id,
    server_date: visit.local_date,
    ...(mutation.reason ? { skip_reason: mutation.reason } : {}),
  };
  await tx
    .insertInto("sync_conflicts")
    .values({
      appointment_id: visit.id,
      technician_id: techId,
      kind,
      client_key: key,
      details: JSON.stringify(details),
    })
    .onConflict((oc) => oc.constraint("sync_conflicts_client_key").doNothing())
    .execute();
}

async function arrive(tx: Tx, techId: string, mutation: Extract<Mutation, { kind: "arrive" }>): Promise<MutationResult> {
  const visit = await lockVisit(tx, mutation.appointmentId);
  if (!visit) return { key: mutation.key, status: "rejected", message: "This visit is no longer on file." };
  if (visit.technician_id !== techId) return { key: mutation.key, status: "conflict", message: "The office gave this visit to someone else." };
  if (visit.local_date !== mutation.date) return { key: mutation.key, status: "conflict", message: "The office moved this visit to another day." };
  if (visit.status === "scheduled") {
    await tx.updateTable("appointments").set({ status: "in_progress", arrived_at: new Date(mutation.at) }).where("id", "=", visit.id).execute();
    return { key: mutation.key, status: "applied" };
  }
  if (visit.status === "in_progress" || visit.status === "completed") return { key: mutation.key, status: "duplicate" };
  return { key: mutation.key, status: "conflict", message: "The office changed this visit." };
}

async function complete(tx: Tx, m: MemberSession, techId: string, mutation: Extract<Mutation, { kind: "complete" }>): Promise<MutationResult> {
  const visit = await lockVisit(tx, mutation.appointmentId);
  if (!visit) return { key: mutation.key, status: "rejected", message: "This visit is no longer on file." };
  const tech = (await tx.selectFrom("technicians").select(["display_name", "applicator_license_no"]).where("id", "=", techId).executeTakeFirstOrThrow())!;
  const biz = await business(tx);
  const applicationAddress = formatAddress({ line1: visit.address_line1, line2: visit.address_line2, city: visit.city, region: visit.region, postalCode: visit.postal_code });
  const customerAddress =
    visit.billing_address_line1 && visit.billing_city && visit.billing_region && visit.billing_postal_code
      ? formatAddress({ line1: visit.billing_address_line1, line2: visit.billing_address_line2, city: visit.billing_city, region: visit.billing_region, postalCode: visit.billing_postal_code })
      : applicationAddress;

  // Records first: what was applied in the field is a fact whatever the schedule
  // now says. Every record is checked before any is written, so a refusal
  // never leaves half a stop behind.
  const productIds = [...new Set(mutation.applications.map((a) => a.productId))];
  const products = productIds.length
    ? await tx.selectFrom("products").select(["id", "name", "kind", "epa_reg_no", "signal_word", "restricted_use"]).where("id", "in", productIds).execute()
    : [];
  const productOf = new Map(products.map((p) => [p.id, p]));
  const rows = [];
  for (const a of mutation.applications) {
    const product = productOf.get(a.productId);
    if (!product) return { key: mutation.key, status: "rejected", message: "A product on this stop is no longer in the catalog. Ask the office." };
    const row = {
      appointment_id: visit.id,
      product_id: product.id,
      technician_id: techId,
      customer_name: visit.customer_name,
      customer_address: customerAddress,
      application_address: applicationAddress,
      business_name: biz.name,
      business_address: biz.address,
      business_license_no: biz.licenseNo,
      applicator_name: tech.display_name,
      applicator_license_no: tech.applicator_license_no,
      product_name: product.name,
      product_kind: product.kind,
      epa_reg_no: product.epa_reg_no,
      signal_word: product.signal_word,
      restricted_use: product.restricted_use,
      mix_rate: String(a.mixRate),
      mix_unit: a.mixUnit,
      total_amount: String(a.totalAmount),
      amount_unit: a.amountUnit,
      area_treated: String(a.areaTreated),
      area_unit: a.areaUnit,
      target_sites: a.targetSites,
      target_pests: a.targetPests,
      applied_at: new Date(a.appliedAt),
      captured_at: new Date(a.capturedAt),
      customer_statement_at: a.customerStatementAt ? new Date(a.customerStatementAt) : null,
      state_template: biz.state,
      client_key: a.key,
    };
    // FR-TEC-07: the same check the device ran, so a refusal names the field instead of a constraint.
    const missing = missingRecordFields({
      productId: row.product_id, technicianId: row.technician_id, customerName: row.customer_name, customerAddress: row.customer_address,
      applicationAddress: row.application_address, businessName: row.business_name, businessAddress: row.business_address,
      businessLicenseNo: row.business_license_no, applicatorName: row.applicator_name, applicatorLicenseNo: row.applicator_license_no,
      productName: row.product_name, productKind: row.product_kind as ApplicationDraft["productKind"], epaRegNo: row.epa_reg_no,
      signalWord: row.signal_word as ApplicationDraft["signalWord"], restrictedUse: row.restricted_use, mixRate: a.mixRate, mixUnit: a.mixUnit,
      totalAmount: a.totalAmount, amountUnit: a.amountUnit, areaTreated: a.areaTreated, areaUnit: a.areaUnit, targetSites: a.targetSites,
      targetPests: a.targetPests, appliedAt: a.appliedAt, customerStatementAt: a.customerStatementAt,
    });
    if (missing.length) return { key: mutation.key, status: "rejected", message: `The record for ${product.name} is missing: ${missing.join(", ")}.` };
    rows.push(row);
  }
  if (rows.length) {
    await tx.insertInto("applications").values(rows).onConflict((oc) => oc.constraint("applications_client_key").doNothing()).execute();
  }

  if (mutation.payment.method !== "invoice_later") {
    await tx
      .insertInto("payments")
      .values({
        customer_id: visit.customer_id,
        client_payment_key: mutation.payment.key,
        method: mutation.payment.method,
        status: "succeeded",
        amount_cents: mutation.payment.amountCents,
        check_number: mutation.payment.method === "check" ? mutation.payment.checkNumber : null,
        received_at: new Date(mutation.at),
        collected_by: m.userId,
      })
      .onConflict((oc) => oc.constraint("payments_client_key").doNothing())
      .execute();
  }

  // Then the schedule, where the server wins.
  const mine = visit.technician_id === techId && visit.local_date === mutation.date;
  if (mine && visit.status === "completed") return { key: mutation.key, status: "duplicate" };
  if (mine && OPEN.includes(visit.status)) {
    await tx
      .updateTable("appointments")
      .set({
        status: "completed",
        completed_at: new Date(mutation.at),
        arrived_at: sql`coalesce(arrived_at, ${new Date(mutation.at)}::timestamptz)`,
        tech_notes: mutation.notes,
        checklist_results: JSON.stringify(mutation.checklist),
        signer_name: mutation.signerName ?? null,
      })
      .where("id", "=", visit.id)
      .execute();
    return { key: mutation.key, status: "applied" };
  }
  await raiseConflict(tx, mutation.key, techId, visit, "completed_after_change", mutation);
  return { key: mutation.key, status: "conflict", message: "Saved. The office changed this visit while you were working, so they will review it." };
}

async function skip(tx: Tx, techId: string, mutation: Extract<Mutation, { kind: "skip" }>): Promise<MutationResult> {
  const visit = await lockVisit(tx, mutation.appointmentId);
  if (!visit) return { key: mutation.key, status: "rejected", message: "This visit is no longer on file." };
  const mine = visit.technician_id === techId && visit.local_date === mutation.date;
  if (mine && visit.status === "skipped") return { key: mutation.key, status: "duplicate" };
  if (mine && OPEN.includes(visit.status)) {
    await tx.updateTable("appointments").set({ status: "skipped", skip_reason: mutation.reason, sequence: null }).where("id", "=", visit.id).execute();
    return { key: mutation.key, status: "applied" };
  }
  await raiseConflict(tx, mutation.key, techId, visit, "skipped_after_change", mutation);
  return { key: mutation.key, status: "conflict", message: "The office changed this visit, so they will review the skip." };
}

/**
 * Applies a batch in order, each mutation in its own transaction, so one
 * refusal or failure never blocks the rest (FR-BIL-03's rule, applied here too).
 */
export async function applyMutations(m: MemberSession, mutations: Mutation[]): Promise<MutationResult[]> {
  const techId = await withRls(m.claims, async (tx) => (await technicianFor(tx, m.userId))?.id);
  if (!techId) throw new NotATechnicianError();
  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    try {
      results.push(
        await withRls(m.claims, (tx) =>
          mutation.kind === "arrive" ? arrive(tx, techId, mutation) : mutation.kind === "complete" ? complete(tx, m, techId, mutation) : skip(tx, techId, mutation),
        ),
      );
    } catch (error) {
      // Not the device's fault: keep it queued and try again later.
      console.error("tech upload failed", { tenant: m.tenantId, key: mutation.key, kind: mutation.kind, error });
      results.push({ key: mutation.key, status: "retry", message: "The server could not save this just now. It will try again." });
    }
  }
  return results;
}
