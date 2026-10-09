import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls, type Tx } from "@/lib/db/rls";
import { formatAddress } from "@/lib/domain/contact";
import { todayIn } from "@/lib/domain/time";
import { generateVisits } from "./generation";
import { geocoder } from "./geocoding";

export const PAGE_SIZE = 50;

export async function searchCustomers(m: MemberSession, opts: { q?: string; page?: number; status?: "active" | "inactive" | "all" }) {
  const q = opts.q?.trim().toLowerCase() ?? "";
  const page = Math.max(1, opts.page ?? 1);
  const today = todayIn(m.timezone);
  return withRls(m.claims, async (tx) => {
    let base = tx.selectFrom("customers as c");
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      const digits = q.replace(/\D/g, "");
      base = base.where((eb) =>
        eb.or([
          eb("c.search_text", "like", like),
          ...(digits.length >= 4 ? [eb("c.phone", "like", `%${digits}%`)] : []),
          eb.exists(
            eb
              .selectFrom("properties as p")
              .select(sql`1`.as("one"))
              .whereRef("p.tenant_id", "=", "c.tenant_id")
              .whereRef("p.customer_id", "=", "c.id")
              .where(sql<boolean>`lower(p.address_line1 || ' ' || p.city || ' ' || p.postal_code) like ${like}`),
          ),
        ]),
      );
    }
    if (opts.status && opts.status !== "all") base = base.where("c.status", "=", opts.status);

    const total = Number((await base.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow()).n);
    const rows = await base
      .select([
        "c.id", "c.display_name", "c.phone", "c.email", "c.status", "c.kind",
        (eb) =>
          eb
            .selectFrom("properties as p")
            .select(sql<string>`p.address_line1 || ', ' || p.city`.as("address"))
            .whereRef("p.tenant_id", "=", "c.tenant_id")
            .whereRef("p.customer_id", "=", "c.id")
            .orderBy("p.created_at")
            .limit(1)
            .as("first_address"),
        (eb) =>
          eb
            .selectFrom("appointments as a")
            .select("a.local_date")
            .whereRef("a.tenant_id", "=", "c.tenant_id")
            .whereRef("a.customer_id", "=", "c.id")
            .where("a.status", "=", "scheduled")
            .where("a.local_date", ">=", today)
            .orderBy("a.local_date")
            .limit(1)
            .as("next_visit"),
        (eb) =>
          eb
            .selectFrom("subscriptions as s")
            .select((e) => e.fn.countAll<number>().as("n"))
            .whereRef("s.tenant_id", "=", "c.tenant_id")
            .whereRef("s.customer_id", "=", "c.id")
            .where("s.status", "=", "active")
            .as("active_plans"),
      ])
      .orderBy(sql`lower(c.display_name)`)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  });
}

export async function getCustomer(m: MemberSession, id: string) {
  const today = todayIn(m.timezone);
  return withRls(m.claims, async (tx) => {
    const customer = await tx.selectFrom("customers").selectAll().where("id", "=", id).executeTakeFirst();
    if (!customer) return null;

    const properties = await tx
      .selectFrom("properties")
      .select([
        "id", "label", "address_line1", "address_line2", "city", "region", "postal_code", "access_notes",
        "geocode_confidence", "location_locked", "location_confirmed_at", "sq_ft", "lawn_area_sq_ft", "status",
        sql<number | null>`extensions.st_y(location::extensions.geometry)`.as("lat"),
        sql<number | null>`extensions.st_x(location::extensions.geometry)`.as("lng"),
      ])
      .where("customer_id", "=", id)
      .orderBy("created_at")
      .execute();

    const subscriptions = await tx
      .selectFrom("subscriptions as s")
      .innerJoin("service_plans as p", (j) => j.onRef("p.id", "=", "s.plan_id").onRef("p.tenant_id", "=", "s.tenant_id"))
      .select([
        "s.id", "s.status", "s.start_date", "s.rrule", "s.price_cents", "s.initial_price_cents", "s.billing_mode",
        "s.autopay", "s.property_id", "s.cancel_reason", "s.paused_from", "s.paused_until", "p.name as plan_name",
      ])
      .where("s.customer_id", "=", id)
      .orderBy("s.created_at")
      .execute();

    const visits = await tx
      .selectFrom("appointments as a")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "a.technician_id").onRef("tech.tenant_id", "=", "a.tenant_id"))
      .select([
        "a.id", "a.local_date", "a.window_start", "a.window_end", "a.status", "a.is_initial", "a.price_cents",
        "a.property_id", "a.skip_reason", "a.cancel_reason", "t.name as service_type_name", "tech.display_name as technician_name",
      ])
      .where("a.customer_id", "=", id)
      .orderBy("a.local_date", "desc")
      .limit(100)
      .execute();

    const balance = await tx
      .selectFrom("customer_balances")
      .select("balance_cents")
      .where("customer_id", "=", id)
      .executeTakeFirst();

    return {
      customer,
      properties,
      subscriptions,
      upcoming: visits.filter((v) => v.local_date && v.local_date >= today && v.status === "scheduled").reverse(),
      history: visits.filter((v) => !(v.local_date && v.local_date >= today && v.status === "scheduled")),
      balanceCents: Number(balance?.balance_cents ?? 0),
    };
  });
}

export interface NewCustomerInput {
  /** ENG-01: one per form render; a retry or double submit returns the customer it made. */
  clientKey: string;
  kind: "residential" | "commercial";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  smsConsent: boolean;
  emailOptIn: boolean;
  notes: string | null;
  /** FR-SAL-02: the technician credited with this sale, if any. */
  soldByTechnicianId?: string | null;
  property: { line1: string; line2: string | null; city: string; region: string; postalCode: string; accessNotes: string | null };
  plan: null | {
    planId: string;
    startDate: string;
    technicianId: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    autopay: boolean;
  };
}

export function displayNameFor(i: Pick<NewCustomerInput, "kind" | "firstName" | "lastName" | "companyName">): string {
  const person = [i.firstName, i.lastName].filter(Boolean).join(" ");
  if (i.kind === "commercial" && i.companyName) return i.companyName;
  return person || i.companyName || "Unnamed customer";
}

/**
 * F02: customer, property and (optionally) a plan in one transaction, then the
 * plan's first visits, so the CSR leaves this screen with work on the schedule.
 */
export async function createCustomer(m: MemberSession, input: NewCustomerInput): Promise<{ customerId: string; visitsCreated: number; commissionId: string | null }> {
  // Geocode before opening the transaction: a slow provider must not hold a connection.
  const geo = await geocoder()
    .geocode({ line1: input.property.line1, city: input.property.city, region: input.property.region, postalCode: input.property.postalCode })
    .catch(() => null);

  return withRls(m.claims, async (tx) => {
    const now = new Date();
    const customer = await tx
      .insertInto("customers")
      .values({
        kind: input.kind,
        first_name: input.firstName,
        last_name: input.lastName,
        company_name: input.companyName,
        display_name: displayNameFor(input),
        email: input.email,
        phone: input.phone,
        sms_consent_at: input.smsConsent ? now : null,
        sms_consent_source: input.smsConsent ? `${m.role === "technician" ? "technician" : "office"}:${m.userId}` : null,
        email_opt_in: input.emailOptIn,
        email_opt_in_at: input.emailOptIn ? now : null,
        notes: input.notes,
        sold_by_technician_id: input.soldByTechnicianId ?? null,
        client_key: input.clientKey,
      })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!customer) {
      // ENG-01: already created by an earlier submit. Nothing else is made, so no second set of visits or commission.
      const existing = await tx.selectFrom("customers").select("id").where("client_key", "=", input.clientKey).executeTakeFirstOrThrow();
      return { customerId: existing.id, visitsCreated: 0, commissionId: null };
    }

    const property = await tx
      .insertInto("properties")
      .values({
        customer_id: customer.id,
        address_line1: input.property.line1,
        address_line2: input.property.line2,
        city: input.property.city,
        region: input.property.region,
        postal_code: input.property.postalCode,
        access_notes: input.property.accessNotes,
        location: geo ? sql`extensions.st_setsrid(extensions.st_makepoint(${geo.lng}, ${geo.lat}), 4326)::extensions.geography` : null,
        geocode_confidence: geo ? String(geo.confidence) : null,
        geocode_source: geo?.source ?? null,
        geocoded_at: geo ? now : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    let visitsCreated = 0;
    let subscriptionId: string | null = null;
    if (input.plan) {
      subscriptionId = await sellPlan(tx, { customerId: customer.id, propertyId: property.id, ...input.plan });
      visitsCreated = (await generateVisits(tx, m.tenantId, { subscriptionIds: [subscriptionId] })).created;
    }
    // FR-SAL-02: the database works out the commission from the owner's rule.
    const commissionId = input.soldByTechnicianId
      ? ((await sql<{ id: string }>`select app.record_sale_commission(${customer.id}::uuid, ${subscriptionId}::uuid) as id`.execute(tx)).rows[0]?.id ?? null)
      : null;
    return { customerId: customer.id, visitsCreated, commissionId };
  });
}

export async function sellPlan(
  tx: Tx,
  input: { customerId: string; propertyId: string; planId: string; startDate: string; technicianId: string | null; windowStart: string | null; windowEnd: string | null; autopay: boolean },
): Promise<string> {
  const plan = await tx
    .selectFrom("service_plans")
    .select(["id", "service_type_id", "rrule", "price_cents", "initial_price_cents", "billing_mode", "default_duration_min", "active"])
    .where("id", "=", input.planId)
    .executeTakeFirst();
  if (!plan || !plan.active) throw new Error("That plan is not available");
  const type = await tx.selectFrom("service_types").select("default_duration_min").where("id", "=", plan.service_type_id).executeTakeFirstOrThrow();

  const sub = await tx
    .insertInto("subscriptions")
    .values({
      customer_id: input.customerId,
      property_id: input.propertyId,
      plan_id: plan.id,
      service_type_id: plan.service_type_id,
      start_date: input.startDate,
      rrule: plan.rrule,
      price_cents: plan.price_cents,
      initial_price_cents: plan.initial_price_cents,
      billing_mode: plan.billing_mode,
      duration_min: plan.default_duration_min ?? type.default_duration_min,
      autopay: input.autopay,
      preferred_technician_id: input.technicianId,
      preferred_window_start: input.windowStart,
      preferred_window_end: input.windowEnd,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return sub.id;
}

export function propertyAddress(p: { address_line1: string; address_line2: string | null; city: string; region: string; postal_code: string }) {
  return formatAddress({ line1: p.address_line1, line2: p.address_line2, city: p.city, region: p.region, postalCode: p.postal_code });
}

// Edits (FR-CRM-01) -------------------------------------------------------------------

export class StaleRecordError extends Error {
  override name = "StaleRecordError";
  constructor(what: string) {
    super(`Someone else changed this ${what} while you were editing. Reload to see the latest, then try again.`);
  }
}

export interface CustomerEdit {
  id: string;
  version: number;
  kind: "residential" | "commercial";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  smsConsent: boolean;
  emailOptIn: boolean;
  status: "active" | "inactive";
  notes: string | null;
}

/**
 * Consent is history, not a flag: granting records when and who (CR-07);
 * withdrawing records an opt-out time instead of erasing the grant.
 */
export async function updateCustomer(m: MemberSession, input: CustomerEdit): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const current = await tx
      .selectFrom("customers")
      .select(["sms_consent_at", "sms_opted_out_at", "email_opt_in"])
      .where("id", "=", input.id)
      .where("version", "=", input.version)
      .executeTakeFirst();
    if (!current) throw new StaleRecordError("customer");
    const now = new Date();
    const hadSms = current.sms_consent_at !== null && current.sms_opted_out_at === null;
    const smsChanges =
      input.smsConsent && !hadSms
        ? { sms_consent_at: now, sms_consent_source: `office:${m.userId}`, sms_opted_out_at: null }
        : !input.smsConsent && hadSms
          ? { sms_opted_out_at: now }
          : {};
    const result = await tx
      .updateTable("customers")
      .set({
        kind: input.kind,
        first_name: input.firstName,
        last_name: input.lastName,
        company_name: input.companyName,
        display_name: displayNameFor(input),
        email: input.email,
        phone: input.phone,
        email_opt_in: input.emailOptIn,
        email_opt_in_at: input.emailOptIn ? (current.email_opt_in ? undefined : now) : null,
        status: input.status,
        notes: input.notes,
        ...smsChanges,
      })
      .where("id", "=", input.id)
      .where("version", "=", input.version)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw new StaleRecordError("customer");
  });
}

export interface PropertyInput {
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  accessNotes: string | null;
  sqFt: number | null;
  lawnAreaSqFt: number | null;
}

export async function getProperty(m: MemberSession, customerId: string, propertyId: string) {
  return withRls(m.claims, (tx) =>
    tx
      .selectFrom("properties")
      .select(["id", "version", "address_line1", "address_line2", "city", "region", "postal_code", "access_notes", "sq_ft", "lawn_area_sq_ft", "location_locked", "geocode_confidence"])
      .where("id", "=", propertyId)
      .where("customer_id", "=", customerId)
      .executeTakeFirst(),
  );
}

export async function addProperty(m: MemberSession, customerId: string, input: PropertyInput): Promise<string> {
  const geo = await geocoder()
    .geocode({ line1: input.line1, city: input.city, region: input.region, postalCode: input.postalCode })
    .catch(() => null);
  return withRls(m.claims, async (tx) => {
    const row = await tx
      .insertInto("properties")
      .values({
        customer_id: customerId,
        address_line1: input.line1,
        address_line2: input.line2,
        city: input.city,
        region: input.region,
        postal_code: input.postalCode,
        access_notes: input.accessNotes,
        sq_ft: input.sqFt,
        lawn_area_sq_ft: input.lawnAreaSqFt,
        location: geo ? sql`extensions.st_setsrid(extensions.st_makepoint(${geo.lng}, ${geo.lat}), 4326)::extensions.geography` : null,
        geocode_confidence: geo ? String(geo.confidence) : null,
        geocode_source: geo?.source ?? null,
        geocoded_at: geo ? new Date() : null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

/**
 * An address change re-geocodes, unless a person confirmed and locked the pin
 * (R-BUG-05): then the old pin stays and is flagged for a check instead.
 */
export async function updateProperty(m: MemberSession, customerId: string, propertyId: string, version: number, input: PropertyInput): Promise<{ addressChanged: boolean; pinKept: boolean }> {
  const before = await getProperty(m, customerId, propertyId);
  if (!before || before.version !== version) throw new StaleRecordError("property");
  const addressChanged =
    before.address_line1 !== input.line1 || before.city !== input.city || before.region !== input.region || before.postal_code !== input.postalCode;
  const geo =
    addressChanged && !before.location_locked
      ? await geocoder()
          .geocode({ line1: input.line1, city: input.city, region: input.region, postalCode: input.postalCode })
          .catch(() => null)
      : null;

  await withRls(m.claims, async (tx) => {
    const result = await tx
      .updateTable("properties")
      .set({
        address_line1: input.line1,
        address_line2: input.line2,
        city: input.city,
        region: input.region,
        postal_code: input.postalCode,
        access_notes: input.accessNotes,
        sq_ft: input.sqFt,
        lawn_area_sq_ft: input.lawnAreaSqFt,
        ...(addressChanged && !before.location_locked
          ? {
              location: geo ? sql`extensions.st_setsrid(extensions.st_makepoint(${geo.lng}, ${geo.lat}), 4326)::extensions.geography` : null,
              geocode_confidence: geo ? String(geo.confidence) : null,
              geocode_source: geo?.source ?? null,
              geocoded_at: geo ? new Date() : null,
              location_confirmed_at: null,
              location_confirmed_by: null,
            }
          : {}),
        ...(addressChanged && before.location_locked ? { location_confirmed_at: null } : {}),
      })
      .where("id", "=", propertyId)
      .where("customer_id", "=", customerId)
      .where("version", "=", version)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw new StaleRecordError("property");
  });
  return { addressChanged, pinKept: addressChanged && before.location_locked };
}

/** Everything the pin check needs (FR-CRM-02). */
export async function getPropertyPin(m: MemberSession, customerId: string, propertyId: string) {
  return withRls(m.claims, async (tx) => {
    const property = await tx
      .selectFrom("properties as p")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "p.customer_id").onRef("c.tenant_id", "=", "p.tenant_id"))
      .select([
        "p.id", "p.version", "p.address_line1", "p.address_line2", "p.city", "p.region", "p.postal_code",
        "p.geocode_confidence", "p.geocode_source", "p.location_confirmed_at", "p.location_locked", "c.display_name as customer_name",
        sql<number | null>`extensions.st_y(p.location::extensions.geometry)`.as("lat"),
        sql<number | null>`extensions.st_x(p.location::extensions.geometry)`.as("lng"),
      ])
      .where("p.id", "=", propertyId)
      .where("p.customer_id", "=", customerId)
      .executeTakeFirst();
    if (!property) return null;
    const office = await tx
      .selectFrom("offices")
      .select([
        sql<number | null>`extensions.st_y(location::extensions.geometry)`.as("lat"),
        sql<number | null>`extensions.st_x(location::extensions.geometry)`.as("lng"),
      ])
      .where("is_primary", "=", true)
      .executeTakeFirst();
    return { property, office: office?.lat != null && office.lng != null ? { lat: office.lat, lng: office.lng } : null };
  });
}

/**
 * FR-CRM-02, R-BUG-05: a person puts the pin where the building is and
 * confirms it, optionally locking it so no re-geocode or import moves it.
 * A locked pin moves only by unlocking it in the same save, on purpose.
 */
export async function confirmPin(
  m: MemberSession,
  input: { customerId: string; propertyId: string; version: number; lat: number; lng: number; lock: boolean },
): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const current = await tx
      .selectFrom("properties")
      .select([
        "version", "location_locked",
        sql<number | null>`extensions.st_y(location::extensions.geometry)`.as("lat"),
        sql<number | null>`extensions.st_x(location::extensions.geometry)`.as("lng"),
      ])
      .where("id", "=", input.propertyId)
      .where("customer_id", "=", input.customerId)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.version !== input.version) throw new StaleRecordError("property");
    // About a centimetre: anything closer is the same spot.
    const moved = current.lat === null || current.lng === null || Math.abs(current.lat - input.lat) > 1e-7 || Math.abs(current.lng - input.lng) > 1e-7;
    if (moved && current.location_locked) {
      await tx.updateTable("properties").set({ location_locked: false }).where("id", "=", input.propertyId).execute();
    }
    await tx
      .updateTable("properties")
      .set({
        ...(moved
          ? { location: sql`extensions.st_setsrid(extensions.st_makepoint(${input.lng}, ${input.lat}), 4326)::extensions.geography`, geocode_source: "manual" }
          : {}),
        location_confirmed_at: new Date(),
        location_confirmed_by: m.userId,
        location_locked: input.lock,
      })
      .where("id", "=", input.propertyId)
      .execute();
  });
}
