import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { MemberRole, MemberSession } from "@/lib/auth/session";
import { withRls, type DbClaims, type Tx } from "@/lib/db/rls";
import {
  bucketForecast, convertQty, forecastBuckets, forecastByDay, monthEnd, nextWeekdayAfter, onHand as domainOnHand, orderTotal, pestTrend, productUsed,
  stockUnitFor, suggestResupply, usageOutliers, usageRates, weeklyAverages, weekStart, LONG_WINDOW_WEEKS, SHORT_WINDOW_WEEKS,
  type Bucket, type ForecastRow, type Outlier, type PestTrend, type StockMove, type StockUse, type Suggestion, type TypeBasis, type UsageRate, type UseRecord,
  type WeeklyAverages, type CompletedVisit,
} from "@/lib/domain/inventory";
import { addDays, addMonthsClamped, dateParts, dayOfWeek, makeLocalDate, maxDate, parseLocalDate, todayIn, type LocalDate } from "@/lib/domain/time";
import { AMOUNT_UNITS, type AmountUnit } from "@/lib/domain/units";
import { isCurrentVersion } from "@/lib/server/records";

// Inventory, resupply and truck stock (FR-INV-01..11). Rules: docs/INVENTORY.md.
// Usage is derived from current-version application records at read time; only
// counts, receipts, transfers and adjustments are stored (append-only, ENG-06).

export type InventoryMode = "off" | "forecast" | "tracked";

/** A failure whose message is written for the person using the screen. */
export class InventoryError extends Error {
  override name = "InventoryError";
}

const READ_ROLES: readonly MemberRole[] = ["owner", "admin", "office"];
const WRITE_ROLES: readonly MemberRole[] = ["owner", "admin"];

function allow(m: { role: MemberRole }, roles: readonly MemberRole[]): void {
  if (!roles.includes(m.role)) throw new InventoryError("You do not have access to inventory.");
}

const num = (v: string | null) => (v === null ? null : Number(v));
const ld = (v: string) => parseLocalDate(v);
const isUnit = (u: string): u is AmountUnit => (AMOUNT_UNITS as readonly string[]).includes(u);

function keyOk(key: string): string {
  if (key.length < 8 || key.length > 160) throw new InventoryError("The request key must be 8 to 160 characters.");
  return key;
}

// Settings (FR-INV-01) ----------------------------------------------------------------------

export interface InventorySettings {
  mode: InventoryMode;
  resupplyWeekday: number | null;
  timezone: string;
}

async function settingsIn(tx: Tx): Promise<InventorySettings> {
  const t = await tx.selectFrom("tenants").select(["inventory_mode", "resupply_weekday", "timezone"]).executeTakeFirstOrThrow();
  return { mode: t.inventory_mode as InventoryMode, resupplyWeekday: t.resupply_weekday, timezone: t.timezone };
}

export async function getInventorySettings(m: MemberSession): Promise<InventorySettings> {
  allow(m, READ_ROLES);
  return withRls(m.claims, settingsIn);
}

/** FR-INV-01, FR-INV-06: owner or admin. Tracked mode makes sure a Shop and one truck per active technician exist (idempotent). */
export async function updateInventorySettings(m: MemberSession, input: { mode: InventoryMode; resupplyWeekday: number | null }): Promise<void> {
  allow(m, WRITE_ROLES);
  if (!["off", "forecast", "tracked"].includes(input.mode)) throw new InventoryError("Choose off, forecast or tracked.");
  if (input.resupplyWeekday !== null && !(Number.isInteger(input.resupplyWeekday) && input.resupplyWeekday >= 0 && input.resupplyWeekday <= 6)) {
    throw new InventoryError("Choose a weekday for resupply day.");
  }
  await withRls(m.claims, async (tx) => {
    await tx.updateTable("tenants").set({ inventory_mode: input.mode, resupply_weekday: input.resupplyWeekday }).where("id", "=", m.tenantId).execute();
    if (input.mode === "tracked") await ensureLocations(tx);
  });
}

async function ensureLocations(tx: Tx): Promise<void> {
  const locations = await tx.selectFrom("stock_locations").select(["kind", "name", "technician_id"]).where("active", "=", true).execute();
  const names = new Set(locations.map((l) => l.name.toLowerCase()));
  if (!locations.some((l) => l.kind === "shop")) {
    const name = names.has("shop") ? "Main shop" : "Shop";
    await tx.insertInto("stock_locations").values({ kind: "shop", name }).execute();
    names.add(name.toLowerCase());
  }
  const trucked = new Set(locations.filter((l) => l.technician_id).map((l) => l.technician_id));
  const technicians = await tx.selectFrom("technicians").select(["id", "display_name"]).where("active", "=", true).orderBy("display_name").execute();
  for (const t of technicians) {
    if (trucked.has(t.id)) continue;
    let name = `${t.display_name} truck`;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${t.display_name} truck ${n}`;
    names.add(name.toLowerCase());
    await tx.insertInto("stock_locations").values({ kind: "truck", name: name.slice(0, 80), technician_id: t.id }).execute();
  }
}

// Shared loading ----------------------------------------------------------------------------

interface ProductInfo {
  id: string;
  name: string;
  unit: AmountUnit | null;
  safetyDays: number;
  active: boolean;
}

async function productsIn(tx: Tx): Promise<Map<string, ProductInfo>> {
  const rows = await tx
    .selectFrom("products")
    .select(["id", "name", "stock_unit", "default_mix_unit", "default_amount_unit", "safety_days", "active"])
    .execute();
  return new Map(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        unit: stockUnitFor({ stockUnit: p.stock_unit, defaultMixUnit: p.default_mix_unit, defaultAmountUnit: p.default_amount_unit }),
        safetyDays: p.safety_days,
        active: p.active,
      },
    ]),
  );
}

interface UseGroup {
  productId: string | null;
  technicianId: string | null;
  mixRate: string | null;
  mixUnit: string | null;
  amountUnit: string | null;
  total: string | null;
  amountMissing: boolean;
  n: number;
}

/** Product used by a group of identical rate/unit records. Product used is linear in total_amount, so summing in SQL first is exact. */
function usedByGroup(g: UseGroup, unit: AmountUnit): number | null {
  if (g.amountMissing) return null;
  return productUsed({ mixRate: num(g.mixRate), mixUnit: g.mixUnit, totalAmount: num(g.total), amountUnit: g.amountUnit }, unit);
}

interface ModelUse extends UseRecord {
  technicianId: string | null;
}

interface Model {
  tz: string;
  today: LocalDate;
  settings: InventorySettings;
  products: Map<string, ProductInfo>;
  uses: ModelUse[];
  visits: (CompletedVisit & { technicianId: string | null })[];
  bases: TypeBasis[];
  rates: UsageRate[];
  forecast: ForecastRow[];
  unforecastVisits: number;
  /** Product -> applications that could not be converted (volume vs mass, missing data); never counted as zero. */
  check: Map<string, number>;
  unlinked: number;
}

/**
 * The shared read: 26 weeks of completed visits and the product used on them,
 * rates per service type and product, and the schedule from today to `horizon`
 * grouped in SQL by (date, service type, technician).
 */
async function loadModel(tx: Tx, todayOverride: LocalDate | undefined, horizon: (today: LocalDate) => LocalDate): Promise<Model> {
  const settings = await settingsIn(tx);
  const tz = settings.timezone;
  const today = todayOverride ?? todayIn(tz);
  const from = addDays(today, -(LONG_WINDOW_WEEKS * 7 - 1));
  const products = await productsIn(tx);

  const useGroups = await tx
    .selectFrom("applications as a")
    .innerJoin("appointments as ap", (j) => j.onRef("ap.id", "=", "a.appointment_id").onRef("ap.tenant_id", "=", "a.tenant_id"))
    .where(isCurrentVersion("a"))
    .where("ap.status", "=", "completed")
    .where("ap.local_date", ">=", from)
    .where("ap.local_date", "<=", today)
    .select([
      "a.product_id", "a.technician_id", "ap.service_type_id", "ap.local_date", "a.mix_rate", "a.mix_unit", "a.amount_unit",
      sql<string | null>`sum(a.total_amount)::text`.as("total"),
      sql<boolean>`(a.total_amount is null)`.as("amount_missing"),
      sql<number>`count(*)::int`.as("n"),
    ])
    .groupBy(["a.product_id", "a.technician_id", "ap.service_type_id", "ap.local_date", "a.mix_rate", "a.mix_unit", "a.amount_unit", sql`(a.total_amount is null)`])
    .execute();

  const visitRows = await tx
    .selectFrom("appointments")
    .where("status", "=", "completed")
    .where("local_date", ">=", from)
    .where("local_date", "<=", today)
    .select(["technician_id", "service_type_id", "local_date", sql<number>`count(*)::int`.as("n")])
    .groupBy(["technician_id", "service_type_id", "local_date"])
    .execute();

  const end = horizon(today);
  const scheduled = await tx
    .selectFrom("appointments")
    .where("status", "in", ["scheduled", "in_progress"])
    .where("local_date", ">=", today)
    .where("local_date", "<=", end)
    .select(["local_date", "service_type_id", "technician_id", sql<number>`count(*)::int`.as("n")])
    .groupBy(["local_date", "service_type_id", "technician_id"])
    .execute();

  const check = new Map<string, number>();
  let unlinked = 0;
  const uses: ModelUse[] = [];
  for (const g of useGroups) {
    if (!g.product_id) {
      unlinked += g.n;
      continue;
    }
    const unit = products.get(g.product_id)?.unit ?? null;
    const used = unit ? usedByGroup({ productId: g.product_id, technicianId: g.technician_id, mixRate: g.mix_rate, mixUnit: g.mix_unit, amountUnit: g.amount_unit, total: g.total, amountMissing: g.amount_missing, n: g.n }, unit) : null;
    if (used === null) check.set(g.product_id, (check.get(g.product_id) ?? 0) + g.n);
    else uses.push({ localDate: ld(g.local_date!), serviceTypeId: g.service_type_id, productId: g.product_id, qty: used, technicianId: g.technician_id });
  }
  const visits = visitRows.map((v) => ({ localDate: ld(v.local_date!), serviceTypeId: v.service_type_id, technicianId: v.technician_id, count: v.n }));
  const { bases, rates } = usageRates(visits, uses, today);
  const { rows: forecast, unforecastVisits } = forecastByDay(
    scheduled.map((s) => ({ localDate: ld(s.local_date!), serviceTypeId: s.service_type_id, technicianId: s.technician_id, visits: s.n })),
    rates,
  );
  return { tz, today, settings, products, uses, visits, bases, rates, forecast, unforecastVisits, check, unlinked };
}

// Usage and forecast (FR-INV-02, FR-INV-03, FR-INV-11) ------------------------------------

export interface ProductForecast {
  productId: string;
  name: string;
  unit: AmountUnit | null;
  weekly: WeeklyAverages;
  /** One value per bucket, same order as `buckets`. */
  forecast: number[];
  /** Completed visits the rates come from ("from 42 visits"). */
  basisVisits: number;
  windowWeeks: 8 | 26 | null;
  /** Applications of this product left out because their units could not be converted. */
  checkUnits: number;
}
export interface TechnicianForecast {
  technicianId: string | null;
  name: string;
  products: { productId: string; forecast: number[] }[];
}
export interface UsageAndForecast {
  today: LocalDate;
  timezone: string;
  buckets: Bucket[];
  products: ProductForecast[];
  technicians: TechnicianForecast[];
  outliers: (Outlier & { technicianName: string; serviceTypeName: string; productName: string })[];
  /** Scheduled visits whose service type has too little history for a rate. */
  unforecastVisits: number;
  /** Visits with no date; reported apart, never spread (docs/INVENTORY.md). */
  unscheduledVisits: number;
  /** Applications with no product linked, so no stock to take them from. */
  unlinkedApplications: number;
}

export async function usageAndForecast(m: MemberSession, opts: { today?: LocalDate } = {}): Promise<UsageAndForecast> {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const model = await loadModel(tx, opts.today, (today) => maxDate(addDays(weekStart(today), 27), monthEnd(today)));
    const { today, products } = model;
    const buckets = forecastBuckets(today);
    const byProduct = bucketForecast(model.forecast, buckets);

    const out: ProductForecast[] = [];
    const ids = new Set<string>([...model.uses.map((u) => u.productId), ...model.forecast.map((f) => f.productId), ...model.check.keys()]);
    for (const id of ids) {
      const p = products.get(id);
      if (!p) continue;
      const own = model.rates.filter((r) => r.productId === id);
      const basisVisits = own.reduce((n, r) => n + r.basis.visits, 0);
      const windows = new Set(own.map((r) => r.basis.windowWeeks));
      out.push({
        productId: id,
        name: p.name,
        unit: p.unit,
        weekly: weeklyAverages(model.uses.filter((u) => u.productId === id), today),
        forecast: byProduct.get(id) ?? buckets.map(() => 0),
        basisVisits,
        windowWeeks: windows.size === 0 ? null : windows.has(26) ? 26 : 8,
        checkUnits: model.check.get(id) ?? 0,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));

    const techs = await tx.selectFrom("technicians").select(["id", "display_name"]).execute();
    const techName = new Map(techs.map((t) => [t.id, t.display_name]));
    const perTech = new Map<string | null, ForecastRow[]>();
    for (const r of model.forecast) perTech.set(r.technicianId, [...(perTech.get(r.technicianId) ?? []), r]);
    const technicians: TechnicianForecast[] = [...perTech]
      .map(([technicianId, rows]) => ({
        technicianId,
        name: technicianId ? (techName.get(technicianId) ?? "Technician") : "Unassigned",
        products: [...bucketForecast(rows, buckets)].map(([productId, forecast]) => ({ productId, forecast })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // FR-INV-11: per technician usage per visit, each service type over the window its rate uses.
    const basis = new Map(model.bases.map((b) => [b.serviceTypeId, b]));
    const startOf = (typeId: string) => {
      const b = basis.get(typeId);
      return addDays(today, -((b?.windowWeeks ?? SHORT_WINDOW_WEEKS) * 7 - 1));
    };
    const visitTotals = new Map<string, number>();
    for (const v of model.visits) {
      if (!v.technicianId || v.localDate < startOf(v.serviceTypeId)) continue;
      const key = `${v.technicianId}|${v.serviceTypeId}`;
      visitTotals.set(key, (visitTotals.get(key) ?? 0) + (v.count ?? 1));
    }
    const qtyTotals = new Map<string, number>();
    for (const u of model.uses) {
      if (!u.technicianId || u.localDate < startOf(u.serviceTypeId)) continue;
      const key = `${u.technicianId}|${u.serviceTypeId}|${u.productId}`;
      qtyTotals.set(key, (qtyTotals.get(key) ?? 0) + u.qty);
    }
    const typeNames = new Map((await tx.selectFrom("service_types").select(["id", "name"]).execute()).map((t) => [t.id, t.name]));
    const outliers = usageOutliers(
      [...qtyTotals].map(([key, qty]) => {
        const [technicianId, serviceTypeId, productId] = key.split("|") as [string, string, string];
        return { technicianId, serviceTypeId, productId, qty, visits: visitTotals.get(`${technicianId}|${serviceTypeId}`) ?? 0 };
      }),
    ).map((o) => ({
      ...o,
      technicianName: techName.get(o.technicianId) ?? "Technician",
      serviceTypeName: typeNames.get(o.serviceTypeId) ?? "Service",
      productName: products.get(o.productId)?.name ?? "Product",
    }));

    const unscheduled = await tx
      .selectFrom("appointments")
      .where("status", "=", "unscheduled")
      .select(sql<number>`count(*)::int`.as("n"))
      .executeTakeFirstOrThrow();

    return {
      today,
      timezone: model.tz,
      buckets,
      products: out,
      technicians,
      outliers,
      unforecastVisits: model.unforecastVisits,
      unscheduledVisits: unscheduled.n,
      unlinkedApplications: model.unlinked,
    };
  });
}

// Vendors (FR-INV-04) ------------------------------------------------------------------------

export interface VendorInput {
  name: string;
  email: string | null;
  phone: string | null;
  accountNo: string | null;
  orderWeekdays: number[];
  minOrderCents: number | null;
  notes: string | null;
  clientKey?: string;
}

function checkVendor(v: VendorInput): void {
  if (!v.name.trim()) throw new InventoryError("A vendor needs a name.");
  if (v.orderWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new InventoryError("Order days must be weekdays.");
  if (v.minOrderCents !== null && !(Number.isInteger(v.minOrderCents) && v.minOrderCents >= 0)) throw new InventoryError("The minimum order must be whole cents.");
}

export async function listVendors(m: MemberSession, opts: { includeInactive?: boolean } = {}) {
  allow(m, READ_ROLES);
  return withRls(m.claims, (tx) => {
    let q = tx
      .selectFrom("vendors")
      .select(["id", "name", "email", "phone", "account_no", "order_weekdays", "min_order_cents", "notes", "active"])
      .orderBy("active", "desc")
      .orderBy("name");
    if (!opts.includeInactive) q = q.where("active", "=", true);
    return q.execute();
  });
}

export async function createVendor(m: MemberSession, input: VendorInput): Promise<string> {
  allow(m, WRITE_ROLES);
  checkVendor(input);
  return withRls(m.claims, async (tx) => {
    const row = await tx
      .insertInto("vendors")
      .values({
        name: input.name.trim(), email: input.email, phone: input.phone, account_no: input.accountNo, order_weekdays: input.orderWeekdays,
        min_order_cents: input.minOrderCents, notes: input.notes, ...(input.clientKey ? { client_key: keyOk(input.clientKey) } : {}),
      })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doUpdateSet({ updated_at: sql`now()` }))
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

export async function updateVendor(m: MemberSession, vendorId: string, input: VendorInput & { active?: boolean }): Promise<void> {
  allow(m, WRITE_ROLES);
  checkVendor(input);
  await withRls(m.claims, async (tx) => {
    await tx
      .updateTable("vendors")
      .set({
        name: input.name.trim(), email: input.email, phone: input.phone, account_no: input.accountNo, order_weekdays: input.orderWeekdays,
        min_order_cents: input.minOrderCents, notes: input.notes, ...(input.active === undefined ? {} : { active: input.active }),
      })
      .where("id", "=", vendorId)
      .execute();
  });
}

export interface VendorProductInput {
  vendorId: string;
  productId: string;
  sku: string | null;
  packageLabel: string;
  packageQty: number;
  packageUnit: AmountUnit;
  priceCents: number | null;
  leadTimeDays: number;
  preferred: boolean;
}

function checkVendorProduct(v: VendorProductInput): void {
  if (!v.packageLabel.trim()) throw new InventoryError("Name the package, for example 1 gal jug.");
  if (!(v.packageQty > 0) || !Number.isFinite(v.packageQty)) throw new InventoryError("A package holds more than zero.");
  if (!isUnit(v.packageUnit)) throw new InventoryError("Choose a package unit.");
  if (v.priceCents !== null && !(Number.isInteger(v.priceCents) && v.priceCents >= 0)) throw new InventoryError("The price must be whole cents.");
  if (!(Number.isInteger(v.leadTimeDays) && v.leadTimeDays >= 0 && v.leadTimeDays <= 60)) throw new InventoryError("Lead time is 0 to 60 days.");
}

export async function listVendorProducts(m: MemberSession, opts: { vendorId?: string } = {}) {
  allow(m, READ_ROLES);
  return withRls(m.claims, (tx) => {
    let q = tx
      .selectFrom("vendor_products as vp")
      .innerJoin("products as p", (j) => j.onRef("p.id", "=", "vp.product_id").onRef("p.tenant_id", "=", "vp.tenant_id"))
      .select([
        "vp.id", "vp.vendor_id", "vp.product_id", "p.name as product_name", "vp.sku", "vp.package_label", "vp.package_qty", "vp.package_unit",
        "vp.price_cents", "vp.lead_time_days", "vp.preferred", "vp.active",
      ])
      .orderBy("p.name")
      .orderBy("vp.package_label");
    if (opts.vendorId) q = q.where("vp.vendor_id", "=", opts.vendorId);
    return q.execute();
  });
}

/** Only one active package per product is preferred; setting one clears the others first. */
export async function createVendorProduct(m: MemberSession, input: VendorProductInput): Promise<string> {
  allow(m, WRITE_ROLES);
  checkVendorProduct(input);
  return withRls(m.claims, async (tx) => {
    if (input.preferred) await tx.updateTable("vendor_products").set({ preferred: false }).where("product_id", "=", input.productId).where("preferred", "=", true).execute();
    const row = await tx
      .insertInto("vendor_products")
      .values({
        vendor_id: input.vendorId, product_id: input.productId, sku: input.sku, package_label: input.packageLabel.trim(), package_qty: input.packageQty,
        package_unit: input.packageUnit, price_cents: input.priceCents, lead_time_days: input.leadTimeDays, preferred: input.preferred,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

export async function updateVendorProduct(m: MemberSession, id: string, input: Omit<VendorProductInput, "vendorId" | "productId"> & { active?: boolean }): Promise<void> {
  allow(m, WRITE_ROLES);
  checkVendorProduct({ ...input, vendorId: "", productId: "" });
  await withRls(m.claims, async (tx) => {
    const current = await tx.selectFrom("vendor_products").select("product_id").where("id", "=", id).executeTakeFirst();
    if (!current) throw new InventoryError("That package no longer exists.");
    if (input.preferred) await tx.updateTable("vendor_products").set({ preferred: false }).where("product_id", "=", current.product_id).where("id", "<>", id).where("preferred", "=", true).execute();
    await tx
      .updateTable("vendor_products")
      .set({
        sku: input.sku, package_label: input.packageLabel.trim(), package_qty: input.packageQty, package_unit: input.packageUnit, price_cents: input.priceCents,
        lead_time_days: input.leadTimeDays, preferred: input.preferred, ...(input.active === undefined ? {} : { active: input.active }),
      })
      .where("id", "=", id)
      .execute();
  });
}

export async function deleteVendorProduct(m: MemberSession, id: string): Promise<void> {
  allow(m, WRITE_ROLES);
  await withRls(m.claims, async (tx) => {
    await tx.deleteFrom("vendor_products").where("id", "=", id).execute();
  });
}

// Stock on hand (FR-INV-06) ------------------------------------------------------------------

export interface StockLocation {
  id: string;
  kind: "shop" | "truck";
  name: string;
  technicianId: string | null;
}

export async function listLocations(m: MemberSession): Promise<StockLocation[]> {
  const rows = await withRls(m.claims, (tx) =>
    tx.selectFrom("stock_locations").select(["id", "kind", "name", "technician_id"]).where("active", "=", true).orderBy("kind", "desc").orderBy("name").execute(),
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind as "shop" | "truck", name: r.name, technicianId: r.technician_id }));
}

export interface StockRow {
  locationId: string;
  productId: string;
  qty: number;
  unit: AmountUnit;
  countedAt: Date | null;
  /** Movements or usage left out because their units cannot be converted. */
  skipped: number;
}

/**
 * docs/INVENTORY.md "On hand": for each (location, product), the latest count
 * plus movements after it, minus the location's technician's usage after it.
 * One query for the movements not superseded by a later count (that is the
 * latest count and everything after it), one grouped query for usage.
 * `asOf` (exclusive) gives the expected quantity at that instant.
 */
async function computeOnHand(tx: Tx, filter: { locationId?: string; productIds?: readonly string[] }, products: Map<string, ProductInfo>, asOf?: Date): Promise<Map<string, StockRow>> {
  if (filter.productIds?.length === 0) return new Map();
  const cutoff = asOf ?? null;
  const limit = (alias: string) => [
    filter.locationId ? sql`and ${sql.ref(`${alias}.location_id`)} = ${filter.locationId}` : sql``,
    filter.productIds ? sql`and ${sql.ref(`${alias}.product_id`)} = any(${sql.val([...filter.productIds])}::uuid[])` : sql``,
  ];
  const moves = await sql<{ location_id: string; product_id: string; kind: string; qty: string; unit: string; at: Date }>`
    select m.location_id, m.product_id, m.kind, m.qty::text, m.unit, m.occurred_at as at
    from public.stock_movements m
    where (${cutoff}::timestamptz is null or m.occurred_at < ${cutoff}::timestamptz)
      ${sql.join(limit("m"), sql` `)}
      and not exists (
        select 1 from public.stock_movements c
        where c.tenant_id = m.tenant_id and c.location_id = m.location_id and c.product_id = m.product_id
          and c.kind = 'count' and c.occurred_at > m.occurred_at
          and (${cutoff}::timestamptz is null or c.occurred_at < ${cutoff}::timestamptz))
  `.execute(tx);

  const usage = await tx
    .selectFrom("applications as a")
    .innerJoin("stock_locations as l", (j) => j.onRef("l.technician_id", "=", "a.technician_id").onRef("l.tenant_id", "=", "a.tenant_id"))
    .where("l.kind", "=", "truck")
    .where("l.active", "=", true)
    .where("a.product_id", "is not", null)
    .where(isCurrentVersion("a"))
    .$if(Boolean(filter.locationId), (q) => q.where("l.id", "=", filter.locationId!))
    .$if(Boolean(filter.productIds), (q) => q.where("a.product_id", "in", [...filter.productIds!]))
    .$if(cutoff !== null, (q) => q.where("a.applied_at", "<", cutoff!))
    .where(
      sql<boolean>`a.applied_at > coalesce((
        select max(c.occurred_at) from public.stock_movements c
        where c.tenant_id = a.tenant_id and c.location_id = l.id and c.product_id = a.product_id and c.kind = 'count'
          and (${cutoff}::timestamptz is null or c.occurred_at < ${cutoff}::timestamptz)), '-infinity'::timestamptz)`,
    )
    .select([
      "l.id as location_id", "a.product_id", "a.mix_rate", "a.mix_unit", "a.amount_unit",
      sql<string | null>`sum(a.total_amount)::text`.as("total"),
      sql<boolean>`(a.total_amount is null)`.as("amount_missing"),
      sql<Date>`max(a.applied_at)`.as("at"),
      sql<number>`count(*)::int`.as("n"),
    ])
    .groupBy(["l.id", "a.product_id", "a.mix_rate", "a.mix_unit", "a.amount_unit", sql`(a.total_amount is null)`])
    .execute();

  const pairs = new Map<string, { locationId: string; productId: string; moves: StockMove[]; uses: StockUse[]; unusable: number }>();
  const pair = (locationId: string, productId: string) => {
    const key = `${locationId}|${productId}`;
    let p = pairs.get(key);
    if (!p) pairs.set(key, (p = { locationId, productId, moves: [], uses: [], unusable: 0 }));
    return p;
  };
  for (const r of moves.rows) {
    if (isUnit(r.unit)) pair(r.location_id, r.product_id).moves.push({ kind: r.kind as StockMove["kind"], qty: Number(r.qty), unit: r.unit, at: new Date(r.at) });
  }
  for (const g of usage) {
    const p = pair(g.location_id, g.product_id!);
    const unit = products.get(g.product_id!)?.unit ?? null;
    const used = unit ? usedByGroup({ productId: g.product_id, technicianId: null, mixRate: g.mix_rate, mixUnit: g.mix_unit, amountUnit: g.amount_unit, total: g.total, amountMissing: g.amount_missing, n: g.n }, unit) : null;
    if (used === null) p.unusable += g.n;
    else p.uses.push({ qty: used, at: new Date(g.at) });
  }

  const out = new Map<string, StockRow>();
  for (const [key, p] of pairs) {
    const unit = products.get(p.productId)?.unit;
    if (!unit) continue;
    const r = domainOnHand(p.moves, p.uses, unit);
    out.set(key, { locationId: p.locationId, productId: p.productId, qty: r.qty, unit, countedAt: r.countedAt, skipped: r.skipped + p.unusable });
  }
  return out;
}

/** FR-INV-06: every location and product with any movement or usage, derived. */
export async function stockOnHand(m: MemberSession): Promise<StockRow[]> {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const rows = [...(await computeOnHand(tx, {}, await productsIn(tx))).values()];
    return rows.sort((a, b) => a.locationId.localeCompare(b.locationId) || a.productId.localeCompare(b.productId));
  });
}

interface MovementBase {
  locationId: string;
  productId: string;
  unit: AmountUnit;
  clientKey: string;
}

function checkQty(qty: number, unit: string): void {
  if (!Number.isFinite(qty) || Math.abs(qty) > 99_999_999) throw new InventoryError("Enter a quantity.");
  if (!isUnit(unit)) throw new InventoryError("Choose a unit.");
}

/** FR-INV-06: a correction with a reason; positive adds, negative removes. A retry with the same key is stored once. */
export async function recordAdjustment(m: MemberSession, input: MovementBase & { qty: number; reason: string }): Promise<void> {
  allow(m, WRITE_ROLES);
  checkQty(input.qty, input.unit);
  if (input.qty === 0) throw new InventoryError("An adjustment cannot be zero.");
  if (!input.reason.trim()) throw new InventoryError("Say why the quantity changed.");
  await withRls(m.claims, async (tx) => {
    await tx
      .insertInto("stock_movements")
      .values({ location_id: input.locationId, product_id: input.productId, kind: "adjust", qty: input.qty, unit: input.unit, reason: input.reason.trim().slice(0, 500), client_key: keyOk(input.clientKey) })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
      .execute();
  });
}

/** FR-INV-06: shop to truck. Two rows sharing a transfer id, keys `<key>:out` and `<key>:in`. Returns the transfer id, null when it was already recorded. */
export async function recordTransfer(m: MemberSession, input: { fromLocationId: string; toLocationId: string; productId: string; qty: number; unit: AmountUnit; clientKey: string }): Promise<string | null> {
  allow(m, WRITE_ROLES);
  checkQty(input.qty, input.unit);
  if (!(input.qty > 0)) throw new InventoryError("Transfer more than zero.");
  if (input.fromLocationId === input.toLocationId) throw new InventoryError("Choose two different places.");
  keyOk(input.clientKey);
  const transferId = randomUUID();
  return withRls(m.claims, async (tx) => {
    const out = await tx
      .insertInto("stock_movements")
      .values({ location_id: input.fromLocationId, product_id: input.productId, kind: "transfer_out", qty: -input.qty, unit: input.unit, transfer_id: transferId, client_key: `${input.clientKey}:out` })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!out) return null;
    await tx
      .insertInto("stock_movements")
      .values({ location_id: input.toLocationId, product_id: input.productId, kind: "transfer_in", qty: input.qty, unit: input.unit, transfer_id: transferId, client_key: `${input.clientKey}:in` })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
      .execute();
    return transferId;
  });
}

export interface CountLine {
  productId: string;
  qty: number;
  unit: AmountUnit;
}

/**
 * FR-INV-07: a count is a baseline. Each line stores what RouteVerde expected
 * just before (expected_qty) so the office sees the variance. Idempotent per
 * line (`<key>:<productId>`), so an offline retry changes nothing. `occurredAt`
 * is when the technician counted (a count made offline syncs later), never in the future.
 */
export async function recordCountIn(tx: Tx, locationId: string, localDate: LocalDate, lines: readonly CountLine[], clientKey: string, occurredAt?: Date): Promise<number> {
  keyOk(clientKey);
  for (const l of lines) {
    checkQty(l.qty, l.unit);
    if (l.qty < 0) throw new InventoryError("A count cannot be negative.");
  }
  const now = new Date();
  const at = occurredAt && occurredAt < now ? occurredAt : now;
  const products = await productsIn(tx);
  const expected = await computeOnHand(tx, { locationId, productIds: lines.map((l) => l.productId) }, products, at);
  let stored = 0;
  for (const l of lines) {
    const unit = products.get(l.productId)?.unit;
    const exp = expected.get(`${locationId}|${l.productId}`)?.qty ?? 0;
    const row = await tx
      .insertInto("stock_movements")
      .values({
        location_id: locationId, product_id: l.productId, kind: "count", qty: l.qty, unit: l.unit, local_date: localDate,
        expected_qty: unit ? (convertQty(exp, unit, l.unit) ?? null) : null, occurred_at: at, client_key: `${clientKey}:${l.productId}`,
      })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (row) stored++;
  }
  return stored;
}

/** FR-INV-07: owner, admin, office or the technician counting their own truck (RLS narrows the rest). Returns lines newly stored. */
export async function recordCount(session: { claims: DbClaims }, locationId: string, localDate: LocalDate, lines: readonly CountLine[], clientKey: string, occurredAt?: Date): Promise<number> {
  return withRls(session.claims, (tx) => recordCountIn(tx, locationId, localDate, lines, clientKey, occurredAt));
}

export interface TruckCheck {
  due: boolean;
  locationId: string | null;
  lines: { productId: string; name: string; unit: AmountUnit; expected: number }[];
}

/** FR-INV-07: due on the business's resupply weekday when tracked and the truck has no count for today. Lines: products ever moved on the truck or used by the technician in the last 8 weeks. */
export async function truckCheckFor(session: { claims: DbClaims }, technicianId: string, today: LocalDate): Promise<TruckCheck> {
  return withRls(session.claims, async (tx) => {
    const none: TruckCheck = { due: false, locationId: null, lines: [] };
    const settings = await settingsIn(tx);
    if (settings.mode !== "tracked" || settings.resupplyWeekday === null) return none;
    const truck = await tx.selectFrom("stock_locations").select("id").where("technician_id", "=", technicianId).where("kind", "=", "truck").where("active", "=", true).executeTakeFirst();
    if (!truck) return none;
    if (dayOfWeek(today) !== settings.resupplyWeekday) return { ...none, locationId: truck.id };
    const counted = await tx.selectFrom("stock_movements").select("id").where("location_id", "=", truck.id).where("kind", "=", "count").where("local_date", "=", today).limit(1).executeTakeFirst();
    if (counted) return { ...none, locationId: truck.id };

    const recent = await tx
      .selectFrom("applications as a")
      .innerJoin("appointments as ap", (j) => j.onRef("ap.id", "=", "a.appointment_id").onRef("ap.tenant_id", "=", "a.tenant_id"))
      .where("a.technician_id", "=", technicianId)
      .where("a.product_id", "is not", null)
      .where("ap.local_date", ">=", addDays(today, -SHORT_WINDOW_WEEKS * 7))
      .where(isCurrentVersion("a"))
      .select("a.product_id")
      .distinct()
      .execute();
    const moved = await tx.selectFrom("stock_movements").select("product_id").where("location_id", "=", truck.id).distinct().execute();
    const ids = [...new Set([...recent.map((r) => r.product_id!), ...moved.map((r) => r.product_id)])];
    const products = await productsIn(tx);
    const stock = ids.length ? await computeOnHand(tx, { locationId: truck.id, productIds: ids }, products) : new Map<string, StockRow>();
    const lines = ids
      .flatMap((id) => {
        const p = products.get(id);
        if (!p?.unit) return [];
        const expected = stock.get(`${truck.id}|${id}`)?.qty ?? 0;
        return p.active || expected > 0 ? [{ productId: id, name: p.name, unit: p.unit, expected }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { due: true, locationId: truck.id, lines };
  });
}

/** FR-INV-07: counted minus expected for counts in the last `days`, for the office. */
export async function countVariances(m: MemberSession, days = 30) {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const rows = await tx
      .selectFrom("stock_movements as s")
      .innerJoin("stock_locations as l", (j) => j.onRef("l.id", "=", "s.location_id").onRef("l.tenant_id", "=", "s.tenant_id"))
      .innerJoin("products as p", (j) => j.onRef("p.id", "=", "s.product_id").onRef("p.tenant_id", "=", "s.tenant_id"))
      .where("s.kind", "=", "count")
      .where("s.occurred_at", ">=", sql<Date>`now() - ${days} * interval '1 day'`)
      .select(["s.id", "s.local_date", "l.name as location_name", "p.name as product_name", "s.qty", "s.expected_qty", "s.unit"])
      .orderBy("s.local_date", "desc")
      .orderBy("l.name")
      .orderBy("p.name")
      .limit(500)
      .execute();
    return rows.map((r) => ({
      id: r.id, localDate: r.local_date, location: r.location_name, product: r.product_name, unit: r.unit, counted: Number(r.qty),
      expected: num(r.expected_qty), variance: r.expected_qty === null ? null : roundVariance(Number(r.qty) - Number(r.expected_qty)),
    }));
  });
}

const roundVariance = (n: number) => Math.round(n * 1e6) / 1e6;

export interface RestockItem {
  productId: string;
  name: string;
  unit: AmountUnit;
  need: number;
  onHand: number;
  shortfall: number;
}
export interface TruckRestock {
  locationId: string;
  name: string;
  technicianId: string;
  /** Visits from today up to, not including, the next resupply day. */
  from: LocalDate;
  until: LocalDate;
  items: RestockItem[];
}

/** FR-INV-08: per truck, forecast for its technician's scheduled visits until the next resupply day, minus what is on it. */
export async function restockList(m: MemberSession, opts: { today?: LocalDate } = {}): Promise<TruckRestock[]> {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const settings = await settingsIn(tx);
    if (settings.mode !== "tracked") return [];
    const model = await loadModel(tx, opts.today, (today) => addDays(today, 7));
    const until = nextWeekdayAfter(model.today, settings.resupplyWeekday ?? dayOfWeek(model.today));
    const trucks = await tx.selectFrom("stock_locations").select(["id", "name", "technician_id"]).where("kind", "=", "truck").where("active", "=", true).where("technician_id", "is not", null).orderBy("name").execute();
    const stock = await computeOnHand(tx, {}, model.products);
    return trucks.map((t) => {
      const need = new Map<string, number>();
      for (const f of model.forecast) {
        if (f.technicianId !== t.technician_id || f.localDate >= until) continue;
        need.set(f.productId, (need.get(f.productId) ?? 0) + f.qty);
      }
      const items: RestockItem[] = [...need]
        .flatMap(([productId, n]) => {
          const p = model.products.get(productId);
          if (!p?.unit) return [];
          const have = stock.get(`${t.id}|${productId}`)?.qty ?? 0;
          return [{ productId, name: p.name, unit: p.unit, need: n, onHand: have, shortfall: Math.max(0, n - have) }];
        })
        .sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name));
      return { locationId: t.id, name: t.name, technicianId: t.technician_id!, from: model.today, until, items };
    });
  });
}

// Resupply suggestions (FR-INV-05) ---------------------------------------------------------

export interface ResupplyLine extends Suggestion {
  productId: string;
  productName: string;
  vendorProductId: string;
  packageLabel: string;
  packageQty: number;
  packageUnit: AmountUnit;
  priceCents: number | null;
}
export interface VendorResupply {
  vendorId: string;
  vendorName: string;
  orderDate: LocalDate;
  lines: ResupplyLine[];
  totalCents: number;
  unpriced: boolean;
  minOrderCents: number | null;
  belowMinimum: boolean;
}
export interface Resupply {
  mode: InventoryMode;
  vendors: VendorResupply[];
  /** Products with forecast need but no preferred package, so nobody to order them from. */
  unsourced: { productId: string; name: string }[];
}

export async function resupplySuggestions(m: MemberSession, opts: { today?: LocalDate } = {}): Promise<Resupply> {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const settings = await settingsIn(tx);
    if (settings.mode === "off") return { mode: "off", vendors: [], unsourced: [] };
    const mode = settings.mode;
    const model = await loadModel(tx, opts.today, (today) => addDays(today, 90));
    const packages = await tx
      .selectFrom("vendor_products as vp")
      .innerJoin("vendors as v", (j) => j.onRef("v.id", "=", "vp.vendor_id").onRef("v.tenant_id", "=", "vp.tenant_id"))
      .where("vp.preferred", "=", true)
      .where("vp.active", "=", true)
      .where("v.active", "=", true)
      .select([
        "vp.id", "vp.vendor_id", "vp.product_id", "vp.package_label", "vp.package_qty", "vp.package_unit", "vp.price_cents", "vp.lead_time_days",
        "v.name as vendor_name", "v.order_weekdays", "v.min_order_cents",
      ])
      .execute();

    const held = new Map<string, number>();
    const open = new Map<string, number>();
    if (mode === "tracked") {
      for (const r of (await computeOnHand(tx, {}, model.products)).values()) held.set(r.productId, (held.get(r.productId) ?? 0) + r.qty);
      const lines = await tx
        .selectFrom("purchase_order_lines as l")
        .innerJoin("purchase_orders as o", (j) => j.onRef("o.id", "=", "l.purchase_order_id").onRef("o.tenant_id", "=", "l.tenant_id"))
        .where("o.status", "=", "sent")
        .select(["l.product_id", "l.packages", "l.package_qty", "l.package_unit"])
        .execute();
      for (const l of lines) {
        const unit = model.products.get(l.product_id)?.unit;
        const q = unit && isUnit(l.package_unit) ? convertQty(l.packages * Number(l.package_qty), l.package_unit, unit) : null;
        if (q !== null) open.set(l.product_id, (open.get(l.product_id) ?? 0) + q);
      }
    }

    const byVendor = new Map<string, VendorResupply>();
    const sourced = new Set<string>();
    for (const p of packages) {
      sourced.add(p.product_id);
      const product = model.products.get(p.product_id);
      if (!product?.unit || !isUnit(p.package_unit)) continue;
      const qty = convertQty(Number(p.package_qty), p.package_unit, product.unit);
      if (qty === null || !(qty > 0)) continue;
      const s = suggestResupply({
        mode, today: model.today, orderWeekdays: p.order_weekdays, leadTimeDays: p.lead_time_days, packageQty: qty, safetyDays: product.safetyDays,
        forecast: model.forecast.filter((f) => f.productId === p.product_id), onHand: held.get(p.product_id) ?? 0, openOrderQty: open.get(p.product_id) ?? 0,
      });
      if (s.packages === 0) continue;
      let v = byVendor.get(p.vendor_id);
      if (!v) {
        byVendor.set(p.vendor_id, (v = { vendorId: p.vendor_id, vendorName: p.vendor_name, orderDate: s.orderDate, lines: [], totalCents: 0, unpriced: false, minOrderCents: p.min_order_cents, belowMinimum: false }));
      }
      v.lines.push({ ...s, productId: p.product_id, productName: product.name, vendorProductId: p.id, packageLabel: p.package_label, packageQty: Number(p.package_qty), packageUnit: p.package_unit, priceCents: p.price_cents });
    }
    for (const v of byVendor.values()) {
      v.lines.sort((a, b) => a.productName.localeCompare(b.productName));
      Object.assign(v, orderTotal(v.lines.map((l) => ({ packages: l.packages, priceCents: l.priceCents })), v.minOrderCents));
    }
    const needed = new Set(model.forecast.map((f) => f.productId));
    const unsourced = [...needed].filter((id) => !sourced.has(id)).flatMap((id) => (model.products.has(id) ? [{ productId: id, name: model.products.get(id)!.name }] : []));
    return { mode, vendors: [...byVendor.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName)), unsourced: unsourced.sort((a, b) => a.name.localeCompare(b.name)) };
  });
}

// Purchase orders (FR-INV-05) ----------------------------------------------------------------

export interface OrderLineInput {
  vendorProductId: string;
  packages: number;
}

function checkLines(lines: readonly OrderLineInput[]): void {
  if (lines.length === 0) throw new InventoryError("Add at least one product.");
  for (const l of lines) if (!(Number.isInteger(l.packages) && l.packages >= 1 && l.packages <= 100000)) throw new InventoryError("Order whole packages, at least one.");
}

async function insertLines(tx: Tx, orderId: string, vendorId: string, lines: readonly OrderLineInput[]): Promise<void> {
  const ids = lines.map((l) => l.vendorProductId);
  const packs = await tx.selectFrom("vendor_products").selectAll().where("id", "in", ids).where("vendor_id", "=", vendorId).execute();
  const byId = new Map(packs.map((p) => [p.id, p]));
  for (const l of lines) {
    const p = byId.get(l.vendorProductId);
    if (!p) throw new InventoryError("A product on this order is not sold by this vendor.");
    await tx
      .insertInto("purchase_order_lines")
      .values({
        purchase_order_id: orderId, vendor_product_id: p.id, product_id: p.product_id, package_label: p.package_label, package_qty: p.package_qty,
        package_unit: p.package_unit, packages: l.packages, price_cents: p.price_cents,
      })
      .execute();
  }
}

/** A draft order: line price and package are copied from the vendor's catalog now, so later price changes never move it. */
export async function createDraft(m: MemberSession, vendorId: string, lines: readonly OrderLineInput[], opts: { notes?: string | null; clientKey?: string } = {}): Promise<{ id: string; number: number | null }> {
  allow(m, WRITE_ROLES);
  checkLines(lines);
  return withRls(m.claims, async (tx) => {
    const order = await tx
      .insertInto("purchase_orders")
      .values({ vendor_id: vendorId, notes: opts.notes ?? null, ...(opts.clientKey ? { client_key: keyOk(opts.clientKey) } : {}) })
      .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
      .returning(["id", "number"])
      .executeTakeFirst();
    if (!order) {
      // A retry of the same request: return the order already made.
      const existing = await tx.selectFrom("purchase_orders").select(["id", "number"]).where("client_key", "=", opts.clientKey!).executeTakeFirstOrThrow();
      return existing;
    }
    await insertLines(tx, order.id, vendorId, lines);
    return order;
  });
}

async function orderIn(tx: Tx, orderId: string) {
  const order = await tx.selectFrom("purchase_orders").selectAll().where("id", "=", orderId).executeTakeFirst();
  if (!order) throw new InventoryError("That order no longer exists.");
  return order;
}

/** Replace a draft's lines. Sent and received orders are never rewritten. */
export async function updateDraftLines(m: MemberSession, orderId: string, lines: readonly OrderLineInput[], notes?: string | null): Promise<void> {
  allow(m, WRITE_ROLES);
  checkLines(lines);
  await withRls(m.claims, async (tx) => {
    const order = await orderIn(tx, orderId);
    if (order.status !== "draft") throw new InventoryError("Only a draft order can be changed.");
    await tx.deleteFrom("purchase_order_lines").where("purchase_order_id", "=", orderId).execute();
    await insertLines(tx, orderId, order.vendor_id, lines);
    if (notes !== undefined) await tx.updateTable("purchase_orders").set({ notes }).where("id", "=", orderId).execute();
  });
}

/** The owner sent the order themselves (email or phone). Expected date defaults to the longest lead time. */
export async function markSent(m: MemberSession, orderId: string, opts: { orderDate?: LocalDate; expectedDate?: LocalDate | null } = {}): Promise<void> {
  allow(m, WRITE_ROLES);
  await withRls(m.claims, async (tx) => {
    const order = await orderIn(tx, orderId);
    if (order.status === "sent") return;
    if (order.status !== "draft") throw new InventoryError("Only a draft order can be marked sent.");
    const tz = (await settingsIn(tx)).timezone;
    const orderDate = opts.orderDate ?? todayIn(tz);
    const lead = await tx
      .selectFrom("purchase_order_lines as l")
      .innerJoin("vendor_products as vp", (j) => j.onRef("vp.id", "=", "l.vendor_product_id").onRef("vp.tenant_id", "=", "l.tenant_id"))
      .where("l.purchase_order_id", "=", orderId)
      .select(sql<number | null>`max(vp.lead_time_days)`.as("days"))
      .executeTakeFirst();
    const expected = opts.expectedDate === undefined ? (lead?.days != null ? addDays(orderDate, lead.days) : null) : opts.expectedDate;
    await tx.updateTable("purchase_orders").set({ status: "sent", sent_at: sql<Date>`now()`, order_date: orderDate, expected_date: expected }).where("id", "=", orderId).execute();
  });
}

/**
 * FR-INV-06: goods arrived. Writes a receive movement per line received
 * (client key `po:<lineId>:receive`, so a retry stores nothing twice) costing
 * packages times the line's price, then closes the order. Over- and short-shipments
 * are whatever `received` says.
 */
export async function markReceived(m: MemberSession, orderId: string, locationId: string, received: readonly { lineId: string; packages: number }[]): Promise<void> {
  allow(m, WRITE_ROLES);
  for (const r of received) if (!(Number.isInteger(r.packages) && r.packages >= 0 && r.packages <= 100000)) throw new InventoryError("Received packages must be whole numbers.");
  await withRls(m.claims, async (tx) => {
    const order = await orderIn(tx, orderId);
    if (order.status === "received") return;
    if (order.status !== "sent") throw new InventoryError("Mark the order sent before receiving it.");
    const lines = await tx.selectFrom("purchase_order_lines").selectAll().where("purchase_order_id", "=", orderId).execute();
    const got = new Map(received.map((r) => [r.lineId, r.packages]));
    for (const line of lines) {
      const packages = got.get(line.id) ?? line.packages;
      await tx.updateTable("purchase_order_lines").set({ received_packages: packages }).where("id", "=", line.id).execute();
      if (packages === 0) continue;
      await tx
        .insertInto("stock_movements")
        .values({
          location_id: locationId, product_id: line.product_id, kind: "receive", qty: packages * Number(line.package_qty), unit: line.package_unit,
          cost_cents: line.price_cents === null ? null : packages * line.price_cents, purchase_order_line_id: line.id, client_key: `po:${line.id}:receive`,
        })
        .onConflict((oc) => oc.columns(["tenant_id", "client_key"]).doNothing())
        .execute();
    }
    await tx.updateTable("purchase_orders").set({ status: "received", received_at: sql<Date>`now()`, received_location_id: locationId }).where("id", "=", orderId).execute();
  });
}

export async function cancelOrder(m: MemberSession, orderId: string): Promise<void> {
  allow(m, WRITE_ROLES);
  await withRls(m.claims, async (tx) => {
    const order = await orderIn(tx, orderId);
    if (order.status === "cancelled") return;
    if (order.status === "received") throw new InventoryError("A received order cannot be cancelled. Adjust the stock instead.");
    await tx.updateTable("purchase_orders").set({ status: "cancelled" }).where("id", "=", orderId).execute();
  });
}

export async function listPurchaseOrders(m: MemberSession, opts: { status?: "draft" | "sent" | "received" | "cancelled"; limit?: number } = {}) {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    let q = tx
      .selectFrom("purchase_orders as o")
      .innerJoin("vendors as v", (j) => j.onRef("v.id", "=", "o.vendor_id").onRef("v.tenant_id", "=", "o.tenant_id"))
      .select([
        "o.id", "o.number", "o.status", "o.order_date", "o.expected_date", "o.sent_at", "o.received_at", "o.vendor_id", "v.name as vendor_name",
        sql<number>`coalesce((select sum(l.packages * coalesce(l.price_cents, 0)) from public.purchase_order_lines l where l.tenant_id = o.tenant_id and l.purchase_order_id = o.id), 0)::int`.as("total_cents"),
        sql<number>`(select count(*) from public.purchase_order_lines l where l.tenant_id = o.tenant_id and l.purchase_order_id = o.id)::int`.as("line_count"),
      ])
      .orderBy("o.created_at", "desc")
      .limit(Math.min(opts.limit ?? 100, 500));
    if (opts.status) q = q.where("o.status", "=", opts.status);
    return q.execute();
  });
}

export async function getPurchaseOrder(m: MemberSession, orderId: string) {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const order = await tx
      .selectFrom("purchase_orders as o")
      .innerJoin("vendors as v", (j) => j.onRef("v.id", "=", "o.vendor_id").onRef("v.tenant_id", "=", "o.tenant_id"))
      .select(["o.id", "o.number", "o.status", "o.order_date", "o.expected_date", "o.sent_at", "o.received_at", "o.received_location_id", "o.notes", "o.version", "o.vendor_id", "v.name as vendor_name", "v.email as vendor_email", "v.account_no as vendor_account_no"])
      .where("o.id", "=", orderId)
      .executeTakeFirst();
    if (!order) return null;
    const lines = await tx
      .selectFrom("purchase_order_lines as l")
      .innerJoin("products as p", (j) => j.onRef("p.id", "=", "l.product_id").onRef("p.tenant_id", "=", "l.tenant_id"))
      .leftJoin("vendor_products as vp", (j) => j.onRef("vp.id", "=", "l.vendor_product_id").onRef("vp.tenant_id", "=", "l.tenant_id"))
      .select(["l.id", "l.product_id", "p.name as product_name", "vp.sku", "l.vendor_product_id", "l.package_label", "l.package_qty", "l.package_unit", "l.packages", "l.price_cents", "l.received_packages"])
      .where("l.purchase_order_id", "=", orderId)
      .orderBy("p.name")
      .execute();
    return { ...order, lines, totalCents: lines.reduce((n, l) => n + l.packages * (l.price_cents ?? 0), 0) };
  });
}

// Spend (FR-INV-09) ----------------------------------------------------------------------------

export interface SpendMonth {
  month: string;
  totalCents: number;
  vendors: { vendorId: string; name: string; cents: number }[];
}

/** FR-INV-09: received orders by business-local month and vendor, newest first. */
export async function spend(m: MemberSession, months = 6): Promise<SpendMonth[]> {
  allow(m, READ_ROLES);
  const n = Math.min(Math.max(Math.trunc(months), 1), 24);
  return withRls(m.claims, async (tx) => {
    const tz = (await settingsIn(tx)).timezone;
    const t = dateParts(todayIn(tz));
    const first = addMonthsClamped(makeLocalDate(t.year, t.month, 1), -(n - 1));
    const rows = await sql<{ month: string; vendor_id: string; name: string; cents: string }>`
      select to_char(o.received_at at time zone ${tz}, 'YYYY-MM') as month, o.vendor_id, v.name,
             sum(coalesce(l.received_packages, 0)::bigint * coalesce(l.price_cents, 0))::text as cents
      from public.purchase_orders o
      join public.vendors v on v.tenant_id = o.tenant_id and v.id = o.vendor_id
      join public.purchase_order_lines l on l.tenant_id = o.tenant_id and l.purchase_order_id = o.id
      where o.status = 'received' and (o.received_at at time zone ${tz})::date >= ${first}::date
      group by 1, 2, 3
      order by 1 desc, 4 desc
    `.execute(tx);
    const out = new Map<string, SpendMonth>();
    for (const r of rows.rows) {
      const month = out.get(r.month) ?? { month: r.month, totalCents: 0, vendors: [] };
      month.vendors.push({ vendorId: r.vendor_id, name: r.name, cents: Number(r.cents) });
      month.totalCents += Number(r.cents);
      out.set(r.month, month);
    }
    return [...out.values()];
  });
}

export interface ServiceCost {
  serviceTypeId: string;
  name: string;
  visits: number;
  /** Material cost per completed visit, integer cents (rounded), from weighted average receipt cost. */
  centsPerVisit: number;
  /** Products used on this service that have no received cost yet, so the figure is a floor. */
  unpricedProducts: string[];
}

/** FR-INV-09: material cost per completed visit by service type: per-visit usage times weighted average cost from the last 12 months of receipts. */
export async function costPerVisit(m: MemberSession, opts: { today?: LocalDate } = {}): Promise<ServiceCost[]> {
  allow(m, READ_ROLES);
  return withRls(m.claims, async (tx) => {
    const model = await loadModel(tx, opts.today, (today) => today);
    const receipts = await tx
      .selectFrom("stock_movements")
      .where("kind", "=", "receive")
      .where("cost_cents", "is not", null)
      .where("occurred_at", ">=", sql<Date>`now() - interval '12 months'`)
      .select(["product_id", "unit", sql<string>`sum(qty)::text`.as("qty"), sql<string>`sum(cost_cents)::text`.as("cents")])
      .groupBy(["product_id", "unit"])
      .execute();
    const sums = new Map<string, { qty: number; cents: number }>();
    for (const r of receipts) {
      const stock = model.products.get(r.product_id)?.unit;
      const q = stock && isUnit(r.unit) ? convertQty(Number(r.qty), r.unit, stock) : null;
      if (q === null) continue;
      const s = sums.get(r.product_id) ?? { qty: 0, cents: 0 };
      s.qty += q;
      s.cents += Number(r.cents);
      sums.set(r.product_id, s);
    }
    const names = new Map((await tx.selectFrom("service_types").select(["id", "name"]).execute()).map((t) => [t.id, t.name]));
    return model.bases
      .filter((b) => b.enough)
      .map((b) => {
        let cents = 0;
        const unpriced: string[] = [];
        for (const r of model.rates.filter((x) => x.serviceTypeId === b.serviceTypeId)) {
          const s = sums.get(r.productId);
          if (s && s.qty > 0) cents += r.perVisit * (s.cents / s.qty);
          else unpriced.push(model.products.get(r.productId)?.name ?? "Product");
        }
        return { serviceTypeId: b.serviceTypeId, name: names.get(b.serviceTypeId) ?? "Service", visits: b.visits, centsPerVisit: Math.round(cents), unpricedProducts: unpriced.sort() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

// Pest activity (FR-INV-10) ---------------------------------------------------------------------

/** FR-INV-10: target pests by ZIP code and week from this business's own records (current versions only), rising first. No other business's data is read. */
export async function pestActivity(m: MemberSession, opts: { weeks?: number; today?: LocalDate } = {}): Promise<{ today: LocalDate; weeks: number; trends: PestTrend[] }> {
  allow(m, READ_ROLES);
  const weeks = Math.min(Math.max(Math.trunc(opts.weeks ?? 12), 9), LONG_WINDOW_WEEKS);
  return withRls(m.claims, async (tx) => {
    const tz = (await settingsIn(tx)).timezone;
    const today = opts.today ?? todayIn(tz);
    const from = addDays(weekStart(today), -7 * (weeks - 1));
    const rows = await tx
      .selectFrom("applications as a")
      .innerJoin("appointments as ap", (j) => j.onRef("ap.id", "=", "a.appointment_id").onRef("ap.tenant_id", "=", "a.tenant_id"))
      .innerJoin("properties as pr", (j) => j.onRef("pr.id", "=", "ap.property_id").onRef("pr.tenant_id", "=", "ap.tenant_id"))
      .where(isCurrentVersion("a"))
      .where("ap.status", "=", "completed")
      .where("ap.local_date", ">=", from)
      .where("ap.local_date", "<=", today)
      .select(["ap.id as appointment_id", "ap.local_date", sql<string>`left(pr.postal_code, 5)`.as("zip"), sql<string>`unnest(a.target_pests)`.as("pest")])
      .distinct()
      .execute();
    const trends = pestTrend(
      rows.map((r) => ({ zip: r.zip, pest: r.pest, localDate: ld(r.local_date!), appointmentId: r.appointment_id })),
      today,
      weeks,
    );
    return { today, weeks, trends };
  });
}
