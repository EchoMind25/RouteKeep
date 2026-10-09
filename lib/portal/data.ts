import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { withAnon, withPortal, type PortalClaims } from "@/lib/db/rls";
import { formatAddress, formatPhone } from "@/lib/domain/contact";
import { todayIn } from "@/lib/domain/time";
import { env } from "@/lib/env";
import { invoiceIn } from "@/lib/server/billing";
import { serviceRecordIn } from "@/lib/server/records";

// FR-POR-02: what a signed-in customer sees. Everything runs as the `portal`
// role, so the database itself limits it to this one customer.

export interface PortalBusiness {
  name: string;
  logoPath: string | null;
  whiteLabel: boolean;
  phone: string | null;
  /** FR-BRD-03: only set for a white label business. */
  accent: string | null;
}

export async function publicBusiness(tenantId: string): Promise<PortalBusiness | null> {
  return withAnon(async (tx) => {
    const r = await sql<{ name: string; logo_path: string | null; white_label: boolean; phone: string | null; brand_accent: string | null }>`select * from app.portal_business(${tenantId}::uuid)`.execute(tx);
    const b = r.rows[0];
    return b ? { name: b.name, logoPath: b.logo_path, whiteLabel: b.white_label, phone: b.phone ? formatPhone(b.phone) : null, accent: b.brand_accent } : null;
  });
}

/** FR-POR-01: always answers the same way, whether or not the address is on file. */
export async function requestSignInLink(tenantId: string, email: string): Promise<boolean> {
  const token = randomBytes(32).toString("base64url");
  return withAnon(async (tx) => (await sql<{ issued: boolean }>`select app.portal_issue_token(${tenantId}::uuid, ${email}, ${token}, ${env().APP_URL}) as issued`.execute(tx)).rows[0]?.issued === true);
}

/** FR-POR-01: durable fixed-window counter (app.rate_limit_hit). True when the call is within the limit. */
export async function withinRateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  return withAnon(async (tx) => (await sql<{ ok: boolean }>`select app.rate_limit_hit(${key}, ${windowSeconds}::int, ${max}::int) as ok`.execute(tx)).rows[0]?.ok === true);
}

export async function redeemSignInLink(tenantId: string, token: string): Promise<string | null> {
  return withAnon(async (tx) => (await sql<{ id: string | null }>`select app.portal_redeem_token(${tenantId}::uuid, ${token}) as id`.execute(tx)).rows[0]?.id ?? null);
}

export async function portalHome(claims: PortalClaims) {
  return withPortal(claims, async (tx) => {
    const tenant = await tx.selectFrom("tenants").select(["name", "timezone"]).executeTakeFirstOrThrow();
    const today = todayIn(tenant.timezone);
    const customer = await tx.selectFrom("customers").select(["id", "display_name", "first_name", "kind", "email"]).executeTakeFirstOrThrow();
    const properties = await tx.selectFrom("properties").select(["id", "address_line1", "address_line2", "city", "region", "postal_code"]).where("status", "=", "active").orderBy("created_at").execute();
    const visits = await tx
      .selectFrom("appointments as a")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .select(["a.id", "a.status", "a.local_date", "a.window_start", "a.window_end", "a.completed_at", "t.name as service"])
      .where((eb) => eb.or([eb.and([eb("a.status", "=", "scheduled"), eb("a.local_date", ">=", today)]), eb("a.status", "=", "completed")]))
      .orderBy("a.local_date", "desc")
      .limit(60)
      .execute();
    const upcoming = visits.filter((v) => v.status === "scheduled").sort((a, b) => (a.local_date ?? "").localeCompare(b.local_date ?? ""));
    const done = visits.filter((v) => v.status === "completed").slice(0, 24);
    const invoices = await tx
      .selectFrom("invoices as i")
      .innerJoin("invoice_balances as b", (j) => j.onRef("b.invoice_id", "=", "i.id").onRef("b.tenant_id", "=", "i.tenant_id"))
      .select(["i.id", "i.number", "i.status", "i.issued_at", "i.total_cents", "b.open_cents"])
      .where("i.status", "in", ["open", "paid"])
      .orderBy("i.issued_at", "desc")
      .limit(24)
      .execute();
    const balance = await tx.selectFrom("customer_balances").select("balance_cents").executeTakeFirst();
    const plans = await tx
      .selectFrom("subscriptions as s")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "s.service_type_id").onRef("t.tenant_id", "=", "s.tenant_id"))
      .select(["s.id", "s.status", "s.price_cents", "t.name as service"])
      .where("s.status", "in", ["active", "paused"])
      .execute();
    const office = await tx.selectFrom("offices").select(["phone", "address_line1", "address_line2", "city", "region", "postal_code"]).where("is_primary", "=", true).executeTakeFirst();
    return {
      timeZone: tenant.timezone,
      customer: { name: customer.display_name, greeting: customer.kind === "commercial" ? customer.display_name : (customer.first_name ?? customer.display_name), email: customer.email },
      properties: properties.map((p) => ({ id: p.id, address: formatAddress({ line1: p.address_line1, line2: p.address_line2, city: p.city, region: p.region, postalCode: p.postal_code }) })),
      upcoming,
      done,
      invoices: invoices.map((i) => ({ ...i, number: Number(i.number), open_cents: Number(i.open_cents ?? 0) })),
      balanceCents: Number(balance?.balance_cents ?? 0),
      plans,
      office: office ? { phone: office.phone ? formatPhone(office.phone) : null, address: formatAddress({ line1: office.address_line1, line2: office.address_line2, city: office.city, region: office.region, postalCode: office.postal_code }) } : null,
    };
  });
}

export function portalRecord(claims: PortalClaims, appointmentId: string) {
  return withPortal(claims, (tx) => serviceRecordIn(tx, appointmentId));
}

export function portalInvoice(claims: PortalClaims, invoiceId: string) {
  return withPortal(claims, (tx) => invoiceIn(tx, invoiceId));
}

export async function portalSignature(claims: PortalClaims, appointmentId: string): Promise<string | null> {
  return withPortal(claims, async (tx) => (await tx.selectFrom("attachments").select("path").where("owner_id", "=", appointmentId).where("kind", "=", "signature").orderBy("captured_at", "desc").executeTakeFirst())?.path ?? null);
}

export async function requestService(claims: PortalClaims, input: { key: string; message: string; preferred: string | null; propertyId: string | null }) {
  await withPortal(claims, async (tx) => {
    await tx
      .insertInto("service_requests")
      .values({ tenant_id: claims.portal_tenant_id, customer_id: claims.portal_customer_id, property_id: input.propertyId, request_key: input.key, message: input.message, preferred_times: input.preferred })
      .onConflict((oc) => oc.constraint("service_request_key").doNothing())
      .execute();
  });
}
