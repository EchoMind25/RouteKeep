"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { failure, fieldErrors, formValues, type FormState } from "@/lib/forms";
import { InventoryError, updateInventorySettings } from "@/lib/server/inventory";

const schema = z
  .object({
    mode: z.enum(["off", "forecast", "tracked"], { error: "Choose how you want to use inventory" }),
    resupplyWeekday: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number().int().min(0).max(6).nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "tracked" && v.resupplyWeekday === null) ctx.addIssue({ code: "custom", path: ["resupplyWeekday"], message: "Choose the day you restock the trucks" });
  });

// FR-INV-01: owner and admin choose the mode and the resupply day.
export async function saveInventorySettingsAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  try {
    await updateInventorySettings(member, { mode: parsed.data.mode, resupplyWeekday: parsed.data.mode === "off" ? null : parsed.data.resupplyWeekday });
  } catch (e) {
    if (e instanceof InventoryError) return failure(values, e.message);
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: parsed.data.mode === "off" ? "Saved. Inventory is off." : "Saved.", values };
}
