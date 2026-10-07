"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isLocalDate, isLocalTime, type LocalDate, type LocalTime } from "@/lib/domain/time";
import { AMOUNT_UNITS, AREA_UNITS, MIX_UNITS } from "@/lib/domain/units";
import { failure, fieldErrors, formValues, trimmed, type FormState } from "@/lib/forms";
import { AlreadyAmendedError, amendRecord, AmendmentInvalidError, RecordGoneError } from "@/lib/server/records";

const amount = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${what}`)
    .transform(Number)
    .pipe(z.number({ error: `Enter the ${what} as a number` }).positive(`Enter the ${what}`).max(100_000_000, "That is too large"));
const list = (what: string) =>
  z
    .string()
    .transform((v) => [...new Set(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(80, "Keep each one under 80 characters")).min(1, `Add at least one ${what}`).max(20, "Up to 20"));
const date = z.string().refine(isLocalDate, "Enter a date") as unknown as z.ZodType<LocalDate>;
const time = z.string().refine(isLocalTime, "Enter a time") as unknown as z.ZodType<LocalTime>;

const schema = z
  .object({
    visitId: z.uuid(),
    recordId: z.uuid(),
    key: z.string().min(8).max(100),
    productId: z.uuid({ error: "Choose a product" }),
    mixRate: amount("mix rate"),
    mixUnit: z.enum(MIX_UNITS, { error: "Choose a unit" }),
    totalAmount: amount("total applied"),
    amountUnit: z.enum(AMOUNT_UNITS, { error: "Choose a unit" }),
    areaTreated: amount("area treated"),
    areaUnit: z.enum(AREA_UNITS, { error: "Choose a unit" }),
    targetSites: list("target site"),
    targetPests: list("target pest"),
    appliedDate: date,
    appliedTime: time,
    statementDate: z.string().optional(),
    statementTime: z.string().optional(),
    reason: trimmed("The reason", 500),
  })
  .transform((v, ctx) => {
    const sd = v.statementDate?.trim() ?? "";
    const st = v.statementTime?.trim() ?? "";
    if (!sd && !st) return { ...v, statementDate: null, statementTime: null };
    if (!isLocalDate(sd)) ctx.addIssue({ code: "custom", path: ["statementDate"], message: "Enter the date it was given" });
    if (!isLocalTime(st)) ctx.addIssue({ code: "custom", path: ["statementTime"], message: "Enter the time it was given" });
    return { ...v, statementDate: sd as LocalDate, statementTime: st as LocalTime };
  });

// FR-REC-03: a correction is a new version of the record, with a reason; the original stays on file.
export async function amendRecordAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  let saved: { appointmentId: string | null };
  try {
    saved = await amendRecord(member, parsed.data);
  } catch (error) {
    if (error instanceof AmendmentInvalidError) return failure(values, error.message, error.field === "form" ? undefined : { [error.field]: error.message });
    if (error instanceof AlreadyAmendedError || error instanceof RecordGoneError) return failure(values, error.message);
    throw error;
  }
  const visitId = saved.appointmentId ?? parsed.data.visitId;
  revalidatePath(`/schedule/visits/${visitId}`);
  revalidatePath("/reports", "layout");
  redirect(`/schedule/visits/${visitId}?done=amended`);
}
