"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isLocalDate } from "@/lib/domain/time";
import { checkbox, failure, fieldErrors, formValues, type FormState } from "@/lib/forms";
import { confirmPin, StaleRecordError } from "@/lib/server/customers";

const coordinate = (label: string, limit: number) =>
  z
    .string()
    .trim()
    .min(1, `Place the pin, or enter the ${label.toLowerCase()}`)
    .transform(Number)
    .pipe(z.number({ error: `${label} must be a number` }).min(-limit, `${label} is out of range`).max(limit, `${label} is out of range`));

const pinSchema = z.object({
  customerId: z.uuid(),
  propertyId: z.uuid(),
  version: z.coerce.number().int().positive(),
  lat: coordinate("Latitude", 90),
  lng: coordinate("Longitude", 180),
  lock: checkbox,
  // Where to go back to: the dispatch board for this day, or the customer.
  date: z.string().optional().transform((v) => (v && isLocalDate(v) ? v : null)),
});

export async function confirmPinAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = pinSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await confirmPin(member, v);
  } catch (error) {
    if (error instanceof StaleRecordError) return failure(values, error.message);
    throw error;
  }
  revalidatePath(`/customers/${v.customerId}`);
  revalidatePath("/schedule");
  redirect(v.date ? `/schedule?date=${v.date}&done=pin` : `/customers/${v.customerId}?done=${v.lock ? "pin_locked" : "pin_confirmed"}`);
}
