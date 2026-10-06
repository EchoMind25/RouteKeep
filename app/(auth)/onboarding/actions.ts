"use server";

import { sql } from "kysely";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authMode } from "@/lib/auth-mode";
import { refreshLocalSession } from "@/lib/auth/local";
import { requireUser } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";
import { isUsState, normalizeUsPhone } from "@/lib/domain/contact";
import { isIanaZone } from "@/lib/domain/time";
import { withRls } from "@/lib/db/rls";
import { failure, fieldErrors, formValues, optionalTrimmed, trimmed, type FormState } from "@/lib/forms";

const schema = z.object({
  name: trimmed("Business name", 120),
  businessLicenseNo: trimmed("License number", 60),
  state: z.string().refine(isUsState, "Choose a state"),
  timezone: z.string().refine(isIanaZone, "Choose a time zone"),
  addressLine1: trimmed("Street address"),
  addressLine2: optionalTrimmed(),
  city: trimmed("City", 80),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code"),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      try {
        return normalizeUsPhone(v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    }),
  clientKey: z.uuid(),
});

export async function createBusiness(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;

  await withRls(user.claims, (tx) =>
    sql`select app.create_tenant(
      ${v.name}, ${v.timezone}, ${v.state}, ${v.businessLicenseNo},
      ${v.addressLine1}, ${v.addressLine2}, ${v.city}, ${v.postalCode}, ${v.phone}, ${v.clientKey})`.execute(tx),
  );

  // The access token now needs the new tenant claim.
  if (authMode() === "local") {
    await refreshLocalSession();
  } else {
    const supabase = await supabaseServer();
    await supabase.auth.refreshSession();
  }
  redirect("/setup");
}
