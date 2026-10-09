"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_ROLES, requireMember, type MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { ContactError, normalizeEmail, normalizeUsPhone } from "@/lib/domain/contact";
import { stockUnitFor } from "@/lib/domain/inventory";
import { parseMoneyToCents } from "@/lib/domain/money";
import { AMOUNT_UNITS, type AmountUnit } from "@/lib/domain/units";
import { checkbox, failure, fieldErrors, formValues, optionalTrimmed, trimmed, type FormState } from "@/lib/forms";
import {
  cancelOrder, createDraft, createVendor, createVendorProduct, deleteVendorProduct, ensureShop, getInventorySettings, InventoryError, listLocations, markReceived, markSent,
  recordAdjustment, recordTransfer, restockList, updateDraftLines, updateVendor, updateVendorProduct,
  type OrderLineInput,
} from "@/lib/server/inventory";

// FR-INV-04, FR-INV-05, FR-INV-06, FR-INV-08: office actions. Owner and admin write; the server functions check again.

async function guarded(values: Record<string, string>, work: () => Promise<FormState>): Promise<FormState> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof InventoryError) return failure(values, e.message);
    throw e;
  }
}

const uuid = z.uuid("Choose one from the list");
const optionalMoney = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      return parseMoneyToCents(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });
const optionalEmail = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      return normalizeEmail(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof ContactError ? e.message : "Check the email address" });
      return z.NEVER;
    }
  });
const optionalPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      return normalizeUsPhone(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof ContactError ? e.message : "Check the phone number" });
      return z.NEVER;
    }
  });

async function stockUnitOf(member: MemberSession, productId: string): Promise<AmountUnit | null> {
  const p = await withRls(member.claims, (tx) =>
    tx.selectFrom("products").select(["stock_unit", "default_mix_unit", "default_amount_unit"]).where("id", "=", productId).executeTakeFirst(),
  );
  return p ? stockUnitFor({ stockUnit: p.stock_unit, defaultMixUnit: p.default_mix_unit, defaultAmountUnit: p.default_amount_unit }) : null;
}

const NO_UNIT = "This product has no stock unit yet. Set one in Settings, Products first.";

// Vendors and packages (FR-INV-04) ----------------------------------------------------------

const vendorSchema = z.object({
  id: uuid.optional().or(z.literal("").transform(() => undefined)),
  name: trimmed("Vendor name", 120),
  email: optionalEmail,
  phone: optionalPhone,
  accountNo: optionalTrimmed(80),
  minOrder: optionalMoney,
  notes: optionalTrimmed(500),
  active: checkbox,
});

export async function saveVendorAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = vendorSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const orderWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => values[`wd${d}`] === "on");
  return guarded(values, async () => {
    const input = { name: v.name, email: v.email, phone: v.phone, accountNo: v.accountNo, orderWeekdays, minOrderCents: v.minOrder, notes: v.notes };
    if (v.id) await updateVendor(member, v.id, { ...input, active: v.active });
    else await createVendor(member, { ...input, clientKey: `vendor-${randomUUID()}` });
    revalidatePath("/inventory", "layout");
    return { ok: true, message: v.id ? "Vendor saved." : `${v.name} added.` };
  });
}

const packageSchema = z.object({
  id: uuid.optional().or(z.literal("").transform(() => undefined)),
  vendorId: uuid.optional().or(z.literal("").transform(() => undefined)),
  productId: uuid.optional().or(z.literal("").transform(() => undefined)),
  sku: optionalTrimmed(60),
  packageLabel: trimmed("Package", 80),
  packageQty: z.string().trim().transform((v) => Number(v)).pipe(z.number({ error: "Enter a number" }).positive("A package holds more than zero").max(1_000_000, "That is too large")),
  packageUnit: z.enum(AMOUNT_UNITS, { error: "Choose a unit" }),
  price: optionalMoney,
  leadTimeDays: z.string().trim().transform((v) => (v === "" ? 0 : Number(v))).pipe(z.number().int("Use whole days").min(0, "Use 0 to 60 days").max(60, "Use 0 to 60 days")),
  preferred: checkbox,
});

export async function saveVendorProductAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = packageSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  if (!v.id && (!v.vendorId || !v.productId)) return failure(values, "Check the highlighted fields.", { productId: "Choose a product" });
  return guarded(values, async () => {
    const input = { sku: v.sku, packageLabel: v.packageLabel, packageQty: v.packageQty, packageUnit: v.packageUnit, priceCents: v.price, leadTimeDays: v.leadTimeDays, preferred: v.preferred };
    if (v.id) await updateVendorProduct(member, v.id, input);
    else await createVendorProduct(member, { ...input, vendorId: v.vendorId!, productId: v.productId! });
    revalidatePath("/inventory", "layout");
    return { ok: true, message: v.id ? "Package saved." : "Package added." };
  });
}

export async function deleteVendorProductAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const id = uuid.safeParse(values.id);
  if (!id.success) return failure(values, "That package could not be found.");
  return guarded(values, async () => {
    try {
      await deleteVendorProduct(member, id.data);
    } catch {
      return failure(values, "This package is on an order, so it cannot be deleted. Edit it instead, or untick Preferred.");
    }
    revalidatePath("/inventory", "layout");
    return { ok: true, message: "Package removed." };
  });
}

// Orders (FR-INV-05) ---------------------------------------------------------------------------

/** Lines from `pick:<id>` ticks and `packages:<id>` counts; a line is kept when ticked (or not removable). */
function orderLines(values: Record<string, string>, ids: readonly string[], keep: (id: string) => boolean): OrderLineInput[] | string {
  const lines: OrderLineInput[] = [];
  for (const id of ids) {
    if (!keep(id)) continue;
    const packages = Number(values[`packages:${id}`]);
    if (!Number.isInteger(packages) || packages < 1) return "Order whole packages, at least one for each ticked line.";
    lines.push({ vendorProductId: id, packages });
  }
  return lines;
}

export async function createDraftAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const vendorId = uuid.safeParse(values.vendorId);
  if (!vendorId.success) return failure(values, "Choose a vendor.");
  const ids = Object.keys(values).filter((k) => k.startsWith("pick:")).map((k) => k.slice(5));
  const lines = orderLines(values, ids, (id) => values[`pick:${id}`] === "on");
  if (typeof lines === "string") return failure(values, lines);
  if (lines.length === 0) return failure(values, "Tick at least one product to order.");
  let created: { id: string } | null = null;
  const result = await guarded(values, async () => {
    created = await createDraft(member, vendorId.data, lines, { clientKey: `draft-${values.requestKey ?? randomUUID()}` });
    return { ok: true };
  });
  if (!result.ok || !created) return result;
  revalidatePath("/inventory", "layout");
  redirect(`/inventory/orders/${(created as { id: string }).id}`);
}

export async function saveDraftAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const orderId = uuid.safeParse(values.orderId);
  if (!orderId.success) return failure(values, "That order could not be found.");
  const existing = (values.lineIds ?? "").split(",").filter(Boolean);
  const lines = orderLines(values, existing, (id) => values[`remove:${id}`] !== "on");
  if (typeof lines === "string") return failure(values, lines);
  if (values.addPackage) {
    const add = Number(values.addPackages || 1);
    if (!uuid.safeParse(values.addPackage).success || !Number.isInteger(add) || add < 1) return failure(values, "Choose a package and a whole number to add.");
    const dup = lines.find((l) => l.vendorProductId === values.addPackage);
    if (dup) dup.packages += add;
    else lines.push({ vendorProductId: values.addPackage, packages: add });
  }
  return guarded(values, async () => {
    await updateDraftLines(member, orderId.data, lines, (values.notes ?? "").trim().slice(0, 500) || null);
    revalidatePath("/inventory", "layout");
    return { ok: true, message: "Draft saved." };
  });
}

export async function markSentAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const orderId = uuid.safeParse(values.orderId);
  if (!orderId.success) return failure(values, "That order could not be found.");
  return guarded(values, async () => {
    await markSent(member, orderId.data);
    revalidatePath("/inventory", "layout");
    return { ok: true, message: "Marked as sent." };
  });
}

export async function cancelOrderAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const orderId = uuid.safeParse(values.orderId);
  if (!orderId.success) return failure(values, "That order could not be found.");
  let done = false;
  const result = await guarded(values, async () => {
    await cancelOrder(member, orderId.data);
    done = true;
    return { ok: true };
  });
  if (!done) return result;
  revalidatePath("/inventory", "layout");
  redirect("/inventory/orders");
}

export async function receiveOrderAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const orderId = uuid.safeParse(values.orderId);
  if (!orderId.success) return failure(values, "That order could not be found.");
  const lineIds = (values.lineIds ?? "").split(",").filter(Boolean);
  const received: { lineId: string; packages: number }[] = [];
  for (const id of lineIds) {
    const packages = Number(values[`received:${id}`]);
    if (!Number.isInteger(packages) || packages < 0) return failure(values, "Enter the packages received for each line, as whole numbers. Use 0 for none.");
    received.push({ lineId: id, packages });
  }
  return guarded(values, async () => {
    const settings = await getInventorySettings(member);
    let locationId: string;
    if (settings.mode === "tracked") {
      const chosen = uuid.safeParse(values.locationId);
      if (!chosen.success) return failure(values, "Choose where the order was delivered.");
      locationId = chosen.data;
    } else {
      locationId = await ensureShop(member);
    }
    await markReceived(member, orderId.data, locationId, received);
    revalidatePath("/inventory", "layout");
    return { ok: true, message: "Received. Stock and spend are updated." };
  });
}

// Stock (FR-INV-06, FR-INV-08) ---------------------------------------------------------------------

const adjustSchema = z.object({
  locationId: uuid,
  productId: uuid,
  qty: z.string().trim().transform((v) => Number(v)).pipe(z.number({ error: "Enter a number" }).refine((n) => n !== 0, "Enter more or less than zero").refine((n) => Math.abs(n) <= 99_999_999, "That is too large")),
  reason: trimmed("Reason", 500),
});

export async function adjustStockAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = adjustSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const unit = await stockUnitOf(member, parsed.data.productId);
  if (!unit) return failure(values, NO_UNIT);
  return guarded(values, async () => {
    await recordAdjustment(member, { ...parsed.data, unit, clientKey: `adjust-${values.requestKey ?? randomUUID()}` });
    revalidatePath("/inventory", "layout");
    return { ok: true, message: "Adjustment saved." };
  });
}

const transferSchema = z.object({
  fromLocationId: uuid,
  toLocationId: uuid,
  productId: uuid,
  qty: z.string().trim().transform((v) => Number(v)).pipe(z.number({ error: "Enter a number" }).positive("Move more than zero").max(99_999_999, "That is too large")),
});

export async function transferStockAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = transferSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const unit = await stockUnitOf(member, parsed.data.productId);
  if (!unit) return failure(values, NO_UNIT);
  return guarded(values, async () => {
    await recordTransfer(member, { ...parsed.data, unit, clientKey: `transfer-${values.requestKey ?? randomUUID()}` });
    revalidatePath("/inventory", "layout");
    return { ok: true, message: "Moved." };
  });
}

/** FR-INV-08: one click moves what the truck is short of from the shop. Recomputed here, never trusted from the page. */
export async function restockTruckAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const truckId = uuid.safeParse(values.locationId);
  if (!truckId.success) return failure(values, "That truck could not be found.");
  return guarded(values, async () => {
    const [lists, locations] = await Promise.all([restockList(member), listLocations(member)]);
    const truck = lists.find((l) => l.locationId === truckId.data);
    const shop = locations.find((l) => l.kind === "shop");
    if (!truck) return failure(values, "That truck could not be found.");
    if (!shop) return failure(values, "There is no shop location to move product from.");
    let moved = 0;
    for (const item of truck.items) {
      const qty = Math.ceil(item.shortfall * 1000) / 1000;
      if (!(qty > 0)) continue;
      // The key follows the amount short, so a double click moves it once.
      const stored = await recordTransfer(member, { fromLocationId: shop.id, toLocationId: truck.locationId, productId: item.productId, qty, unit: item.unit, clientKey: `restock:${truck.locationId}:${truck.from}:${item.productId}:${Math.round(qty * 1000)}` });
      if (stored) moved++;
    }
    revalidatePath("/inventory", "layout");
    return { ok: true, message: moved === 0 ? "Nothing to move. The truck has what it needs." : `Moved ${moved} ${moved === 1 ? "product" : "products"} from the shop to ${truck.name}.` };
  });
}
