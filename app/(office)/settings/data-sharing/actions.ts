"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { pgErrorCode, withRls } from "@/lib/db/rls";
import { isSharingLevel, savedMessage, SHARING_LEVELS } from "@/lib/domain/data-sharing";
import { failure, formValues, type FormState } from "@/lib/forms";

const schema = z.object({
  level: z.enum(SHARING_LEVELS, { error: "Choose what to share" }),
  previous: z.string().optional(),
});

// OPS-04: owners and admins choose the product data level (opt-in; used by
// Settings > Business and the onboarding question on /setup). Setting a value is
// idempotent, so a retried submit needs no client key (ENG-01). RLS
// (tenant_self_update) and the column grant limit the write to owner and admin;
// the trigger app.apply_data_sharing deletes or unlinks past events in the same
// transaction and stamps data_sharing_changed_at, which marks the question as
// answered even when the answer is the starting none. The tenants audit
// trigger records who changed it.
export async function saveDataSharing(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return failure(values, "Choose what to share.", { level: "Choose what to share" });
  const { level, previous } = parsed.data;
  try {
    const result = await withRls(member.claims, (tx) =>
      tx.updateTable("tenants").set({ data_sharing: level }).where("id", "=", member.tenantId).executeTakeFirst(),
    );
    if (Number(result.numUpdatedRows) === 0) return failure(values, "Your role cannot change this. Ask the owner or an admin.");
  } catch (error) {
    if (pgErrorCode(error) === "42501") return failure(values, "Your role cannot change this. Ask the owner or an admin.");
    throw error;
  }
  // The layouts decide whether to load the error reporter from this setting.
  revalidatePath("/", "layout");
  return { ok: true, message: savedMessage(isSharingLevel(previous) ? previous : null, level), values: { level } };
}
