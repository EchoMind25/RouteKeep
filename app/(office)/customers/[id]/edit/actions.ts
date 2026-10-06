"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { ContactError, isUsState, normalizeEmail, normalizeUsPhone } from "@/lib/domain/contact";
import { checkbox, failure, fieldErrors, formValues, optionalTrimmed, trimmed, type FormState } from "@/lib/forms";
import { addProperty, StaleRecordError, updateCustomer, updateProperty } from "@/lib/server/customers";

const contact = (normalize: (v: string) => string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      try {
        return normalize(v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: e instanceof ContactError ? e.message : "Check this value" });
        return z.NEVER;
      }
    });

const customerSchema = z
  .object({
    id: z.uuid(),
    version: z.coerce.number().int().positive(),
    kind: z.enum(["residential", "commercial"]),
    firstName: optionalTrimmed(80),
    lastName: optionalTrimmed(80),
    companyName: optionalTrimmed(120),
    email: contact(normalizeEmail),
    phone: contact(normalizeUsPhone),
    smsConsent: checkbox,
    emailOptIn: checkbox,
    status: z.enum(["active", "inactive"]),
    notes: optionalTrimmed(2000),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "residential" && !v.firstName && !v.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "Enter the customer's name" });
    if (v.kind === "commercial" && !v.companyName) ctx.addIssue({ code: "custom", path: ["companyName"], message: "Enter the business name" });
    if (v.smsConsent && !v.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "Texting consent needs a mobile number" });
  });

export async function updateCustomerAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = customerSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  try {
    await updateCustomer(member, parsed.data);
  } catch (error) {
    if (error instanceof StaleRecordError) return failure(values, error.message);
    throw error;
  }
  revalidatePath(`/customers/${parsed.data.id}`);
  revalidatePath("/customers");
  redirect(`/customers/${parsed.data.id}?done=saved`);
}

const propertySchema = z.object({
  customerId: z.uuid(),
  propertyId: z.string().optional(),
  version: z.string().optional(),
  line1: trimmed("Street address"),
  line2: optionalTrimmed(80),
  city: trimmed("City", 80),
  region: z.string().refine(isUsState, "Choose a state"),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code"),
  accessNotes: optionalTrimmed(1000),
  sqFt: z.string().trim().transform((v) => (v ? Number(v) : null)).pipe(z.number().int().positive("Must be a positive whole number").nullable()),
  lawnAreaSqFt: z.string().trim().transform((v) => (v ? Number(v) : null)).pipe(z.number().int().positive("Must be a positive whole number").nullable()),
});

export async function savePropertyAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = propertySchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const { customerId, propertyId, version, ...input } = parsed.data;
  let done = "property_added";
  try {
    if (propertyId) {
      const r = await updateProperty(member, customerId, z.uuid().parse(propertyId), Number(version), input);
      done = r.pinKept ? "property_pin_kept" : "property_saved";
    } else {
      await addProperty(member, customerId, input);
    }
  } catch (error) {
    if (error instanceof StaleRecordError) return failure(values, error.message);
    throw error;
  }
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?done=${done}`);
}
