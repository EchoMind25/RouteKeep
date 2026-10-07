"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { resolveReview, ReviewGoneError } from "@/lib/server/review";

const input = z.object({ id: z.uuid(), action: z.enum(["accept", "keep"]) });

// NFR-02: the office decides what a visit says after a clash with field work.
export async function resolveReviewAction(data: FormData): Promise<void> {
  const member = await requireMember(OFFICE_ROLES);
  const parsed = input.safeParse({ id: data.get("id"), action: data.get("action") });
  if (!parsed.success) redirect("/schedule/review?done=unreadable");
  try {
    await resolveReview(member, parsed.data);
  } catch (error) {
    if (error instanceof ReviewGoneError) redirect("/schedule/review?done=gone");
    throw error;
  }
  revalidatePath("/schedule", "layout");
  redirect(`/schedule/review?done=${parsed.data.action === "accept" ? "accepted" : "kept"}`);
}
