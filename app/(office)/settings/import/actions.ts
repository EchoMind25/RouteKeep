"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { FIELDS, type ColumnMap } from "@/lib/import/customers";
import { SheetError } from "@/lib/import/parse";
import type { FormState } from "@/lib/forms";
import { canSeeImport } from "./guard";
import { rollbackImport, RollbackRefused, type RollbackResult } from "@/lib/jobs/import-rollback";
import { checkImport, commitStep, ImportError, saveMapping, startImport, type CommitProgress } from "@/lib/server/imports";

// PRD section 9: the import wizard's steps. Owner and admin only.

// About 25,000 customers; hosted functions refuse bodies over about 6 MB.
const MAX_BYTES = 5 * 1024 * 1024;

async function admin() {
  if (!isEnabled("migration")) throw new Error("Import is not available yet.");
  return requireMember(ADMIN_ROLES);
}

export async function startImportAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await admin();
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { ok: false, message: "That file is over 5 MB. Split it into parts and import each one; customers already imported are recognised." };
  if (!/\.(csv|txt)$/i.test(file.name)) return { ok: false, message: "Save the spreadsheet as CSV first (File, Save as, CSV) and upload that." };
  let id: string;
  try {
    id = await startImport(member, { name: file.name, text: await file.text() });
  } catch (error) {
    if (error instanceof SheetError || error instanceof ImportError) return { ok: false, message: error.message };
    throw error;
  }
  redirect(`/settings/import/${id}`);
}

export async function saveMappingAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await admin();
  const id = z.uuid().parse(data.get("id"));
  const map: ColumnMap = {};
  for (const f of FIELDS) {
    const v = data.get(`map.${f.key}`);
    if (typeof v === "string" && v) map[f.key] = v;
  }
  const missing: string[] = FIELDS.filter((f) => "required" in f && f.required && !map[f.key]).map((f) => f.label);
  if (!map.full_name && !map.first_name && !map.last_name && !map.company_name) missing.unshift("A name column");
  if (missing.length) return { ok: false, message: `Choose a column for: ${missing.join(", ")}.` };
  const preset = data.get("savePreset") === "on" ? String(data.get("presetName") ?? "").trim() || null : null;
  try {
    await saveMapping(member, id, map, preset);
    await checkImport(member, id);
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/settings/import/${id}`);
  return { ok: true, message: "Every row checked. Review the results below." };
}

export async function commitStepAction(input: unknown): Promise<{ ok: true; progress: CommitProgress } | { ok: false; message: string }> {
  const member = await admin();
  const id = z.uuid().safeParse((input as { id?: unknown })?.id);
  if (!id.success) return { ok: false, message: "Reload the page and try again." };
  try {
    const progress = await commitStep(member, id.data);
    if (progress.finished) revalidatePath(`/settings/import/${id.data}`);
    return { ok: true, progress };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function rollbackImportAction(input: unknown): Promise<{ ok: true; result: RollbackResult } | { ok: false; message: string }> {
  const member = await admin();
  const id = z.uuid().safeParse((input as { id?: unknown })?.id);
  if (!id.success) return { ok: false, message: "Reload the page and try again." };
  // The job runs as the service role; first make sure this member can see the import at all.
  if (!(await canSeeImport(member, id.data))) return { ok: false, message: "That import was not found." };
  try {
    const result = await rollbackImport(member.tenantId, id.data);
    revalidatePath(`/settings/import/${id.data}`);
    revalidatePath("/customers");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof RollbackRefused) return { ok: false, message: error.message };
    throw error;
  }
}
