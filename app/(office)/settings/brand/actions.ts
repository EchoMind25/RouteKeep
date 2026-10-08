"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms";
import { saveBrandAccent } from "@/lib/server/branding";

// FR-BRD-03: a white label business picks its colour; the app keeps it readable.
export async function saveBrandAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const raw = String(data.get("accent") ?? "").trim().toLowerCase();
  if (raw && !/^#[0-9a-f]{6}$/.test(raw)) return { ok: false, message: "Use a colour like #0b3d2e.", values: { accent: raw } };
  await saveBrandAccent(member, raw || null);
  revalidatePath("/", "layout");
  return { ok: true, message: raw ? "Colour saved. Buttons and links use it, adjusted where needed so text stays readable." : "Back to the standard colour." };
}
