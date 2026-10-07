import "server-only";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";

/** True when the member can read this import under RLS (owner or admin of its business). */
export async function canSeeImport(m: MemberSession, jobId: string): Promise<boolean> {
  return withRls(m.claims, async (tx) => Boolean(await tx.selectFrom("import_jobs").select("id").where("id", "=", jobId).executeTakeFirst()));
}
