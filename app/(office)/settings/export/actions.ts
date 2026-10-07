"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { ExportError, exportStep, requestExport, type ExportStep } from "@/lib/server/exports";

// FR-EXP-01: owner and admin take everything, any time. Built in short steps.

export async function requestExportAction(): Promise<{ ok: true; id: string }> {
  const member = await requireMember(ADMIN_ROLES);
  return { ok: true, id: await requestExport(member) };
}

export async function exportStepAction(input: unknown): Promise<{ ok: true; step: ExportStep } | { ok: false; message: string }> {
  const member = await requireMember(ADMIN_ROLES);
  const id = z.uuid().safeParse((input as { id?: unknown })?.id);
  if (!id.success) return { ok: false, message: "Reload the page and try again." };
  try {
    const step = await exportStep(member, id.data);
    if (step.status === "ready") revalidatePath("/settings/export");
    return { ok: true, step };
  } catch (error) {
    if (error instanceof ExportError) return { ok: false, message: error.message };
    console.error(JSON.stringify({ msg: "export step failed", error: error instanceof Error ? error.message : String(error) }));
    return { ok: false, message: "The export stopped. Start a new one; if it stops again, tell us." };
  }
}
