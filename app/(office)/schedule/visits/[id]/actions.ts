"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isLocalDate, isLocalTime } from "@/lib/domain/time";
import { failure, fieldErrors, formValues, trimmed, type FormState } from "@/lib/forms";
import { cancelVisit, ConflictError, rescheduleVisit, restoreVisit, skipVisit } from "@/lib/server/visits";

const base = { id: z.uuid(), version: z.coerce.number().int().positive() };

const rescheduleSchema = z
  .object({
    ...base,
    localDate: z.string().refine(isLocalDate, "Choose a date"),
    technicianId: z.string().transform((v) => v || null),
    windowStart: z.string().transform((v) => v || null).refine((v) => v === null || isLocalTime(v), "Use a time like 08:00"),
    windowEnd: z.string().transform((v) => v || null).refine((v) => v === null || isLocalTime(v), "Use a time like 12:00"),
  })
  .refine((v) => !v.windowStart || !v.windowEnd || v.windowEnd > v.windowStart, { path: ["windowEnd"], message: "The window must end after it starts" });

const reasonSchema = z.object({ ...base, reason: trimmed("Reason", 200) });

// The form that triggered an action can disappear when the visit changes state
// (a skipped visit has no skip form), so confirmations travel in the URL.
function done(id: string, outcome: "updated" | "skipped" | "cancelled" | "restored"): never {
  revalidatePath(`/schedule/visits/${id}`);
  revalidatePath("/schedule");
  redirect(`/schedule/visits/${id}?done=${outcome}`);
}

async function guarded(values: Record<string, string>, run: () => Promise<FormState>): Promise<FormState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError) return failure(values, error.message);
    throw error;
  }
}

export async function rescheduleAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = rescheduleSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  return guarded(values, async () => {
    await rescheduleVisit(member, parsed.data);
    return done(parsed.data.id, "updated");
  });
}

export async function skipAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = reasonSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Say why the visit is skipped.", fieldErrors(parsed.error));
  return guarded(values, async () => {
    await skipVisit(member, parsed.data);
    return done(parsed.data.id, "skipped");
  });
}

export async function cancelAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = reasonSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Say why the visit is cancelled.", fieldErrors(parsed.error));
  return guarded(values, async () => {
    await cancelVisit(member, parsed.data);
    return done(parsed.data.id, "cancelled");
  });
}

export async function restoreAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = z.object(base).safeParse(values);
  if (!parsed.success) return failure(values, "Reload the page and try again.");
  return guarded(values, async () => {
    await restoreVisit(member, parsed.data);
    return done(parsed.data.id, "restored");
  });
}
