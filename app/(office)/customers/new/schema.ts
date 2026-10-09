import { z } from "zod";
import { ContactError, normalizeEmail, normalizeUsPhone, isUsState } from "@/lib/domain/contact";
import { isLocalDate, isLocalTime } from "@/lib/domain/time";
import { checkbox, optionalTrimmed, trimmed } from "@/lib/forms";
import type { NewCustomerInput } from "@/lib/server/customers";

// The new-customer form's rules, shared by the office screen and a technician's
// sale in the field (FR-CRM-01, FR-SUB-01, FR-SAL-02).

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

export const newCustomerSchema = z
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
    clientKey: z.string().trim().min(8).max(100),
    soldBy: z.union([z.literal(""), z.uuid()]).optional(),
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

export type NewCustomerValues = z.infer<typeof newCustomerSchema>;

export function toNewCustomerInput(v: NewCustomerValues, soldByTechnicianId: string | null): NewCustomerInput {
  return {
    clientKey: v.clientKey,
    kind: v.kind,
    firstName: v.firstName,
    lastName: v.lastName,
    companyName: v.companyName,
    email: v.email,
    phone: v.phone,
    smsConsent: v.smsConsent,
    emailOptIn: v.emailOptIn,
    notes: v.notes,
    soldByTechnicianId,
    property: { line1: v.line1, line2: v.line2, city: v.city, region: v.region, postalCode: v.postalCode, accessNotes: v.accessNotes },
    plan: v.planId
      ? { planId: v.planId, startDate: v.startDate, technicianId: v.technicianId || null, windowStart: v.windowStart || null, windowEnd: v.windowEnd || null, autopay: v.autopay }
      : null,
  };
}
