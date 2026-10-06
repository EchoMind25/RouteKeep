"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/domain/money";
import { isLocalDate, isLocalTime, todayIn } from "@/lib/domain/time";
import { failure, fieldErrors, formValues, trimmed, type FormState } from "@/lib/forms";
import { cancelSubscription, changeSeries, pauseSubscription, reactivateSubscription, resumeSubscription } from "@/lib/server/subscriptions";
import { ConflictError } from "@/lib/server/visits";

// Selling and changing plans is office work (dispatchers schedule, they do not sell).
const SELLERS = ["owner", "admin", "office"] as const;
const base = { id: z.uuid(), customerId: z.uuid(), version: z.coerce.number().int().positive() };
const time = (label: string) =>
  z.string().transform((v) => v || null).refine((v) => v === null || isLocalTime(v), `${label}: use a time like 08:00`);

// Confirmations travel in the URL: the form that ran the action may not exist
// after the plan changes state (a paused plan has no pause form).
function finish(customerId: string, id: string, outcome: string, n: number): never {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/customers/${customerId}/plans/${id}`);
  revalidatePath("/schedule");
  redirect(`/customers/${customerId}/plans/${id}?done=${outcome}&n=${n}`);
}

async function guarded(values: Record<string, string>, run: () => Promise<FormState>): Promise<FormState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError) return failure(values, error.message);
    throw error;
  }
}

const seriesSchema = z
  .object({
    ...base,
    technicianId: z.string().transform((v) => v || null),
    windowStart: time("Window start"),
    windowEnd: time("Window end"),
    price: z.string().transform((v, ctx) => {
      try {
        return parseMoneyToCents(v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    }),
    durationMin: z.coerce.number().int().min(5, "At least 5 minutes").max(600, "At most 10 hours"),
  })
  .refine((v) => !v.windowStart || !v.windowEnd || v.windowEnd > v.windowStart, { path: ["windowEnd"], message: "The window must end after it starts" });

export async function changeSeriesAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(SELLERS);
  const values = formValues(data);
  const parsed = seriesSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  return guarded(values, async () => {
    const changed = await changeSeries(member, { ...v, priceCents: v.price });
    return finish(v.customerId, v.id, "changed", changed);
  });
}

export async function pauseAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(SELLERS);
  const values = formValues(data);
  const today = todayIn(member.timezone);
  const parsed = z
    .object({
      ...base,
      from: z.string().refine(isLocalDate, "Choose when the pause starts").refine((d) => d >= today, "A pause cannot start in the past"),
      until: z.string().transform((v) => v || null).refine((v) => v === null || isLocalDate(v), "Choose a valid date"),
      reason: trimmed("Reason", 200),
    })
    .refine((v) => !v.until || v.until >= v.from, { path: ["until"], message: "The pause must end after it starts" })
    .safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  return guarded(values, async () => {
    const removed = await pauseSubscription(member, parsed.data);
    return finish(parsed.data.customerId, parsed.data.id, "paused", removed);
  });
}

export async function resumeAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(SELLERS);
  const values = formValues(data);
  const parsed = z.object(base).safeParse(values);
  if (!parsed.success) return failure(values, "Reload the page and try again.");
  return guarded(values, async () => {
    const created = await resumeSubscription(member, parsed.data);
    return finish(parsed.data.customerId, parsed.data.id, "resumed", created);
  });
}

export async function cancelPlanAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(SELLERS);
  const values = formValues(data);
  const parsed = z.object({ ...base, reason: trimmed("Reason", 200) }).safeParse(values);
  if (!parsed.success) return failure(values, "Say why the plan is cancelled.", fieldErrors(parsed.error));
  return guarded(values, async () => {
    const r = await cancelSubscription(member, parsed.data);
    return finish(parsed.data.customerId, parsed.data.id, r.cancelled ? "cancelled_with_followup" : "cancelled", r.removed);
  });
}

export async function reactivateAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(SELLERS);
  const values = formValues(data);
  const parsed = z.object(base).safeParse(values);
  if (!parsed.success) return failure(values, "Reload the page and try again.");
  return guarded(values, async () => {
    const created = await reactivateSubscription(member, parsed.data);
    return finish(parsed.data.customerId, parsed.data.id, "reactivated", created);
  });
}
