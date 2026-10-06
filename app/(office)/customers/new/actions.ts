"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { ContactError, isUsState, normalizeEmail, normalizeUsPhone } from "@/lib/domain/contact";
import { isLocalDate, isLocalTime } from "@/lib/domain/time";
import { pgErrorCode } from "@/lib/db/rls";
import { checkbox, failure, fieldErrors, formValues, optionalTrimmed, trimmed, type FormState } from "@/lib/forms";
import { createCustomer } from "@/lib/server/customers";

const optionalContact = (normalize: (v: string) => string) =>
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

const schema = z
  .object({
    kind: z.enum(["residential", "commercial"]),
    firstName: optionalTrimmed(80),
    lastName: optionalTrimmed(80),
    companyName: optionalTrimmed(120),
    email: optionalContact(normalizeEmail),
    phone: optionalContact(normalizeUsPhone),
    smsConsent: checkbox,
    emailOptIn: checkbox,
    notes: optionalTrimmed(2000),
    line1: trimmed("Street address"),
    line2: optionalTrimmed(80),
    city: trimmed("City", 80),
    region: z.string().refine(isUsState, "Choose a state"),
    postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code"),
    accessNotes: optionalTrimmed(1000),
    planId: z.string().trim(),
    startDate: z.string().trim(),
    technicianId: z.string().trim(),
    windowStart: z.string().trim(),
    windowEnd: z.string().trim(),
    autopay: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.kind === "residential" && !v.firstName && !v.lastName) {
      ctx.addIssue({ code: "custom", path: ["lastName"], message: "Enter the customer's name" });
    }
    if (v.kind === "commercial" && !v.companyName) {
      ctx.addIssue({ code: "custom", path: ["companyName"], message: "Enter the business name" });
    }
    if (v.smsConsent && !v.phone) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Texting consent needs a mobile number" });
    }
    if (v.planId) {
      if (!isLocalDate(v.startDate)) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Choose the first visit date" });
      for (const key of ["windowStart", "windowEnd"] as const) {
        if (v[key] && !isLocalTime(v[key])) ctx.addIssue({ code: "custom", path: [key], message: "Use a time like 08:00" });
      }
      if (v.windowStart && v.windowEnd && v.windowEnd <= v.windowStart) {
        ctx.addIssue({ code: "custom", path: ["windowEnd"], message: "The window must end after it starts" });
      }
    }
  });

export async function createCustomerAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(["owner", "admin", "office", "dispatcher"]);
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  if (v.planId && member.role === "dispatcher") {
    return failure(values, "Dispatchers cannot sell plans. Save the customer without a plan, or ask the office.");
  }

  let customerId: string;
  try {
    const result = await createCustomer(member, {
      kind: v.kind,
      firstName: v.firstName,
      lastName: v.lastName,
      companyName: v.companyName,
      email: v.email,
      phone: v.phone,
      smsConsent: v.smsConsent,
      emailOptIn: v.emailOptIn,
      notes: v.notes,
      property: { line1: v.line1, line2: v.line2, city: v.city, region: v.region, postalCode: v.postalCode, accessNotes: v.accessNotes },
      plan: v.planId
        ? {
            planId: v.planId,
            startDate: v.startDate,
            technicianId: v.technicianId || null,
            windowStart: v.windowStart || null,
            windowEnd: v.windowEnd || null,
            autopay: v.autopay,
          }
        : null,
    });
    customerId = result.customerId;
  } catch (error) {
    if (pgErrorCode(error) === "42501") return failure(values, "Your role cannot do that.");
    if (error instanceof Error && error.message === "That plan is not available") return failure(values, error.message, { planId: error.message });
    throw error;
  }
  redirect(`/customers/${customerId}?created=1`);
}
