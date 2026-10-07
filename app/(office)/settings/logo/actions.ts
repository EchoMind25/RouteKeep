"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import type { FormState } from "@/lib/forms";
import { storage } from "@/lib/providers/storage";

const MAX_BYTES = 1024 * 1024;

/** The file's own first bytes decide its type, never the name or the browser's claim. */
function sniff(bytes: Uint8Array): { ext: "png" | "jpg"; type: string } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", type: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  return null;
}

// FR-BRD-02: the business's logo for its invoices (FR-BRD-01). Owner and admin.
export async function uploadLogoAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(ADMIN_ROLES);
  const file = data.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a PNG or JPEG file." };
  if (file.size > MAX_BYTES) return { ok: false, message: "That file is over 1 MB. Save a smaller version and try again." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return { ok: false, message: "Use a PNG or JPEG. Invoices cannot show other formats." };
  const path = `${member.tenantId}/branding/logo.${kind.ext}`;
  await storage().put(path, bytes, kind.type);
  await withRls(member.claims, (tx) => tx.updateTable("tenants").set({ logo_path: path }).where("id", "=", member.tenantId).execute());
  revalidatePath("/settings");
  return { ok: true, message: "Logo saved. Every invoice from now on shows it." };
}

export async function removeLogoAction(): Promise<void> {
  const member = await requireMember(ADMIN_ROLES);
  await withRls(member.claims, (tx) => tx.updateTable("tenants").set({ logo_path: null }).where("id", "=", member.tenantId).execute());
  revalidatePath("/settings");
}
