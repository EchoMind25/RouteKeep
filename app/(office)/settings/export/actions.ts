"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { ExportError, exportStep, requestExport, type ExportStep } from "@/lib/server/exports";
import { errorText, log } from "@/lib/observability/log";

// FR-EXP-01: owner and admin take everything, any time. Built in short steps.

export async function requestExportAction(): Promise<{ ok: true; id: string }> {
  const member = await requireMember(ADMIN_ROLES);
  return { ok: true, id: await requestExport(member) };
}

export async function exportStepAction(input: unknown): Promise<{ ok: true; step: ExportStep } | { ok: false; message: string; resumable?: boolean }> {
  const member = await requireMember(ADMIN_ROLES);
  const id = z.uuid().safeParse((input as { id?: unknown })?.id);
  if (!id.success) return { ok: false, message: "Reload the page and try again." };
  try {
    const step = await exportStep(member, id.data);
    if (step.status === "ready") revalidatePath("/settings/export");
    return { ok: true, step };
  } catch (error) {
    if (error instanceof ExportError) return { ok: false, message: error.message };
    // FR-EXP-01: a statement timeout leaves the export running at the same part, so it can be retried.
    if ((error as { code?: string } | null)?.code === "57014") {
      log.warn("export step timed out", { exportId: id.data });
      return { ok: false, resumable: true, message: "That part took too long. Press Carry on to try it again." };
    }
    log.error("export step failed", { error: errorText(error) });
    return { ok: false, message: "The export stopped. Start a new one; if it stops again, tell us." };
  }
}
