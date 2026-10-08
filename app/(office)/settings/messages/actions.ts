"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { failure, fieldErrors, formValues, type FormState } from "@/lib/forms";
import { goLive, saveTenDlc } from "@/lib/server/messages";

export async function goLiveAction(): Promise<void> {
  const member = await requireMember(ADMIN_ROLES);
  await goLive(member);
  revalidatePath("/settings/messages");
}

// FR-MSG-03: the details a text-message brand registration asks for. Saved
// now; submitted once the business has an SMS provider account (D-10).
const tenDlc = z.object({
  legalName: z.string().trim().min(2, "Enter the legal business name").max(120),
  ein: z.string().trim().regex(/^\d{2}-?\d{7}$/, "Enter the 9-digit EIN, like 12-3456789"),
  website: z.string().trim().max(200).refine((v) => v === "" || /^https?:\/\/\S+\.\S+/.test(v), "Start with https://"),
  contactEmail: z.email("Enter an email address"),
  useCase: z.string().trim().min(10, "Describe the texts in a sentence").max(500),
});

export async function saveTenDlcAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const values = formValues(data);
  const v = tenDlc.safeParse(values);
  if (!v.success) return failure(values, "Check the highlighted fields.", fieldErrors(v.error));
  await saveTenDlc(member, v.data);
  revalidatePath("/settings/messages");
  return { ok: true, message: "Saved. These go into the registration once texts are set up." };
}
