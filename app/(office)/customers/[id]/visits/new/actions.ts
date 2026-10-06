"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/domain/money";
import { isLocalDate, isLocalTime } from "@/lib/domain/time";
import { failure, fieldErrors, formValues, optionalTrimmed, type FormState } from "@/lib/forms";
import { createOneOffVisit } from "@/lib/server/visits";

const schema = z
  .object({
    customerId: z.uuid(),
    propertyId: z.uuid("Choose the address"),
    serviceTypeId: z.uuid("Choose a service"),
    localDate: z.string().transform((v) => v || null).refine((v) => v === null || isLocalDate(v), "Choose a valid date"),
    technicianId: z.string().transform((v) => v || null),
    windowStart: z.string().transform((v) => v || null).refine((v) => v === null || isLocalTime(v), "Use a time like 08:00"),
    windowEnd: z.string().transform((v) => v || null).refine((v) => v === null || isLocalTime(v), "Use a time like 12:00"),
    price: z.string().transform((v, ctx) => {
      if (!v.trim()) return null;
      try {
        return parseMoneyToCents(v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    }),
    notes: optionalTrimmed(1000),
    clientKey: z.uuid(),
  })
  .refine((v) => !v.windowStart || !v.windowEnd || v.windowEnd > v.windowStart, { path: ["windowEnd"], message: "The window must end after it starts" });

export async function createVisitAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(OFFICE_ROLES);
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const id = await createOneOffVisit(member, { ...v, priceCents: v.price });
  redirect(`/schedule/visits/${id}`);
}
