"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, MEMBER_ROLES, requireMember } from "@/lib/auth/session";
import { ContactError, isUsState, normalizeEmail, normalizeUsPhone } from "@/lib/domain/contact";
import { parseMoneyToCents } from "@/lib/domain/money";
import { normalizeRule, RuleError } from "@/lib/domain/recurrence";
import { isIanaZone, isLocalDate } from "@/lib/domain/time";
import { AMOUNT_UNITS, MIX_UNITS } from "@/lib/domain/units";
import { pgConstraint, pgErrorCode, withRls } from "@/lib/db/rls";
import { checkbox, failure, fieldErrors, formValues, optionalTrimmed, trimmed, type FormState } from "@/lib/forms";
import { InviteError, inviteMember } from "@/lib/server/team";

const phoneField = z
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

const money = (label: string, optional = false) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) {
        if (!optional) ctx.addIssue({ code: "custom", message: `${label} is required` });
        return null;
      }
      try {
        return parseMoneyToCents(v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    });

function deniedOr(error: unknown, values: Record<string, string>): FormState {
  if (pgErrorCode(error) === "42501") return failure(values, "Your role cannot change this. Ask the owner or an admin.");
  throw error;
}

// Business profile ------------------------------------------------------------------

const businessSchema = z.object({
  name: trimmed("Business name", 120),
  businessLicenseNo: trimmed("License number", 60),
  state: z.string().refine(isUsState, "Choose a state"),
  timezone: z.string().refine(isIanaZone, "Choose a time zone"),
  addressLine1: trimmed("Street address"),
  addressLine2: optionalTrimmed(80),
  city: trimmed("City", 80),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code"),
  phone: phoneField,
});

export async function updateBusiness(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = businessSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await withRls(member.claims, async (tx) => {
      await tx
        .updateTable("tenants")
        .set({ name: v.name, business_license_no: v.businessLicenseNo, state: v.state, timezone: v.timezone })
        .where("id", "=", member.tenantId)
        .execute();
      await tx
        .updateTable("offices")
        .set({ address_line1: v.addressLine1, address_line2: v.addressLine2, city: v.city, region: v.state, postal_code: v.postalCode, phone: v.phone, name: v.name })
        .where("is_primary", "=", true)
        .execute();
    });
  } catch (error) {
    return deniedOr(error, values);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved.", values };
}

// Team ---------------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().transform((v, ctx) => {
    try {
      return normalizeEmail(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  }),
  role: z.enum(MEMBER_ROLES),
  displayName: optionalTrimmed(120),
});

export async function inviteMemberAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  try {
    await inviteMember(member, parsed.data);
  } catch (error) {
    if (pgErrorCode(error) === "42501") return failure(values, "Only the owner can add owners and admins.", { role: "Not allowed for your role" });
    if (error instanceof InviteError) return failure(values, error.message);
    // Configuration and provider errors stay in the logs, not on the form.
    if (error instanceof Error && !pgErrorCode(error)) {
      console.error(JSON.stringify({ at: "inviteMemberAction", error: error.message }));
      return failure(values, "The invitation could not be sent. Try again, or contact support if it keeps happening.");
    }
    throw error;
  }
  revalidatePath("/settings/team");
  return { ok: true, message: `Invitation sent to ${parsed.data.email}.` };
}

// Technicians (FR-SET-02) -------------------------------------------------------------------

const technicianSchema = z.object({
  displayName: trimmed("Name", 120),
  phone: phoneField,
  applicatorLicenseNo: trimmed("Applicator license number", 60),
  licenseExpiry: z.string().refine(isLocalDate, "Enter the license expiry date"),
  categories: optionalTrimmed(200),
  colorIndex: z.coerce.number().int().min(0).max(11),
});

export async function createTechnician(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = technicianSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await withRls(member.claims, (tx) =>
      tx
        .insertInto("technicians")
        .values({
          display_name: v.displayName,
          phone: v.phone,
          applicator_license_no: v.applicatorLicenseNo,
          license_expiry: v.licenseExpiry,
          categories: v.categories ? v.categories.split(",").map((c) => c.trim()).filter(Boolean) : [],
          color_index: v.colorIndex,
        })
        .execute(),
    );
  } catch (error) {
    return deniedOr(error, values);
  }
  revalidatePath("/settings/technicians");
  revalidatePath("/setup");
  return { ok: true, message: `${v.displayName} added.` };
}

// Service plans (FR-SET-04) ---------------------------------------------------------------------

const planSchema = z
  .object({
    name: trimmed("Plan name", 120),
    serviceTypeId: z.uuid("Choose a service type"),
    price: money("Price per visit"),
    initialPrice: money("First visit price", true),
    preset: z.string(),
    customRule: z.string().trim().optional(),
    billingMode: z.enum(["per_service", "monthly", "quarterly", "annually"]),
    durationMin: z.string().trim().transform((v) => (v ? Number(v) : null)).pipe(z.number().int().min(5).max(600).nullable()),
  })
  .transform((v, ctx) => {
    const source = v.preset === "custom" ? (v.customRule ?? "") : v.preset;
    try {
      return { ...v, rrule: normalizeRule(source) };
    } catch (e) {
      ctx.addIssue({ code: "custom", path: [v.preset === "custom" ? "customRule" : "preset"], message: e instanceof RuleError ? e.message : "Choose how often" });
      return z.NEVER;
    }
  });

export async function createPlan(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = planSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await withRls(member.claims, (tx) =>
      tx
        .insertInto("service_plans")
        .values({
          name: v.name,
          service_type_id: v.serviceTypeId,
          price_cents: v.price!,
          initial_price_cents: v.initialPrice,
          rrule: v.rrule,
          billing_mode: v.billingMode,
          default_duration_min: v.durationMin,
        })
        .execute(),
    );
  } catch (error) {
    return deniedOr(error, values);
  }
  revalidatePath("/settings/plans");
  revalidatePath("/setup");
  return { ok: true, message: `${v.name} created.` };
}

export async function setPlanActive(data: FormData): Promise<void> {
  const member = await requireMember(ADMIN_ROLES);
  const id = z.uuid().parse(data.get("id"));
  const active = data.get("active") === "true";
  await withRls(member.claims, (tx) => tx.updateTable("service_plans").set({ active }).where("id", "=", id).execute());
  revalidatePath("/settings/plans");
}

// Products (FR-SET-03) ------------------------------------------------------------------------------

const productSchema = z
  .object({
    name: trimmed("Product name", 160),
    kind: z.enum(["pesticide", "minimum_risk", "fertilizer", "other"]),
    epaRegNo: z.string().trim().transform((v) => v || null),
    signalWord: z.string().transform((v) => (v ? v : null)).pipe(z.enum(["caution", "warning", "danger", "danger_poison"]).nullable()),
    restrictedUse: checkbox,
    activeIngredients: optionalTrimmed(300),
    defaultMixRate: z.string().trim().transform((v) => (v ? Number(v) : null)).pipe(z.number().positive("Mix rate must be more than zero").nullable()),
    defaultMixUnit: z.string().transform((v) => v || null).pipe(z.enum(MIX_UNITS).nullable()),
    defaultAmountUnit: z.string().transform((v) => v || null).pipe(z.enum(AMOUNT_UNITS).nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "pesticide" && !v.epaRegNo) {
      ctx.addIssue({ code: "custom", path: ["epaRegNo"], message: "Registered pesticides need their EPA registration number" });
    }
    if (v.epaRegNo && !/^\d{1,7}-\d{1,6}(-\d{1,7})?$/.test(v.epaRegNo)) {
      ctx.addIssue({ code: "custom", path: ["epaRegNo"], message: "Use the format on the label, like 12345-678" });
    }
    if ((v.defaultMixRate === null) !== (v.defaultMixUnit === null)) {
      ctx.addIssue({ code: "custom", path: ["defaultMixRate"], message: "Give both a mix rate and its unit, or neither" });
    }
    if (v.defaultMixUnit === "pct" && v.defaultMixRate !== null && v.defaultMixRate > 100) {
      ctx.addIssue({ code: "custom", path: ["defaultMixRate"], message: "A percentage cannot be more than 100" });
    }
  });

export async function createProduct(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = productSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await withRls(member.claims, (tx) =>
      tx
        .insertInto("products")
        .values({
          name: v.name,
          kind: v.kind,
          epa_reg_no: v.epaRegNo,
          signal_word: v.signalWord,
          restricted_use: v.restrictedUse,
          active_ingredients: v.activeIngredients,
          default_mix_rate: v.defaultMixRate === null ? null : String(v.defaultMixRate),
          default_mix_unit: v.defaultMixUnit,
          default_amount_unit: v.defaultAmountUnit,
        })
        .execute(),
    );
  } catch (error) {
    if (pgConstraint(error) === "pesticide_has_epa_no") return failure(values, "Check the highlighted fields.", { epaRegNo: "Registered pesticides need their EPA registration number" });
    return deniedOr(error, values);
  }
  revalidatePath("/settings/products");
  revalidatePath("/setup");
  return { ok: true, message: `${v.name} added.` };
}

// FR-INV-02, FR-INV-05: the unit a product's stock is kept in, and the days of cover to keep above zero.
const stockSchema = z.object({
  id: z.uuid(),
  stockUnit: z.string().transform((v) => v || null).pipe(z.enum(AMOUNT_UNITS, { error: "Choose a unit" }).nullable()),
  safetyDays: z
    .string()
    .trim()
    .transform((v) => (v === "" ? 0 : Number(v)))
    .pipe(z.number({ error: "Enter a number of days" }).int("Use whole days").min(0, "Use 0 to 365 days").max(365, "Use 0 to 365 days")),
});

export async function updateProductStock(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = stockSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  try {
    await withRls(member.claims, (tx) =>
      tx.updateTable("products").set({ stock_unit: parsed.data.stockUnit, safety_days: parsed.data.safetyDays }).where("id", "=", parsed.data.id).execute(),
    );
  } catch (error) {
    return deniedOr(error, values);
  }
  revalidatePath("/settings/products");
  revalidatePath("/inventory", "layout");
  return { ok: true, message: "Saved." };
}
