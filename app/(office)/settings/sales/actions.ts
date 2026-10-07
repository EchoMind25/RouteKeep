"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/domain/money";
import { checkbox, failure, fieldErrors, formValues, type FormState } from "@/lib/forms";
import { updateSalesSettings } from "@/lib/server/sales";

const schema = z.object({
  enabled: checkbox,
  flat: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return 0;
      try {
        const cents = parseMoneyToCents(v);
        if (cents < 0 || cents > 10_000_000) throw new Error("Use an amount from $0 to $100,000");
        return cents;
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    }),
  pct: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return 0;
      const n = Number(v.replace(/%$/, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) !== n * 100) {
        ctx.addIssue({ code: "custom", message: "Use a percent from 0 to 100, up to two decimals" });
        return z.NEVER;
      }
      return n;
    }),
});

// FR-SAL-01: the owner decides whether technicians add customers, and what a sale earns.
export async function saveSalesSettingsAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  await updateSalesSettings(member, { enabled: parsed.data.enabled, flatCents: parsed.data.flat, pct: parsed.data.pct });
  revalidatePath("/settings/sales");
  return { ok: true, message: "Saved. Changes apply to sales made from now on; earlier commissions keep their amount.", values };
}
