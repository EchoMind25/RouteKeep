"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { CommissionChangedError, decideCommission } from "@/lib/server/sales";

const input = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().positive(),
  status: z.enum(["approved", "paid", "pending", "void"]),
  note: z.string().trim().max(500).optional(),
  back: z.string().startsWith("/reports/commissions").max(500),
});

// FR-SAL-03: the office approves, marks paid (payroll happens outside the app), or voids with a reason.
export async function decideCommissionAction(data: FormData): Promise<void> {
  const member = await requireMember(["owner", "admin", "office"]);
  const parsed = input.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/reports/commissions?done=unreadable");
  const { back, ...v } = parsed.data;
  const join = back.includes("?") ? "&" : "?";
  if (v.status === "void" && !v.note) redirect(`${back}${join}done=reason`);
  try {
    await decideCommission(member, { id: v.id, version: v.version, status: v.status, note: v.status === "void" ? (v.note ?? null) : null });
  } catch (error) {
    if (error instanceof CommissionChangedError) redirect(`${back}${join}done=changed`);
    throw error;
  }
  revalidatePath("/reports/commissions");
  redirect(`${back}${join}done=${v.status}`);
}
