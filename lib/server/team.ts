import "server-only";
import { sql } from "kysely";
import { authMode } from "@/lib/auth-mode";
import { ensureLocalUser } from "@/lib/auth/local";
import type { MemberRole, MemberSession } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/auth/supabase-admin";
import { withRls } from "@/lib/db/rls";
import { env } from "@/lib/env";

export async function listTeam(m: MemberSession) {
  return withRls(m.claims, (tx) =>
    tx
      .selectFrom("memberships")
      .select(["id", "user_id", "email", "display_name", "role", "deactivated_at", "created_at"])
      .where("tenant_id", "=", m.tenantId)
      .orderBy("deactivated_at", (ob) => ob.desc().nullsFirst())
      .orderBy("created_at")
      .execute(),
  );
}

/**
 * FR-SET-02. Creates (or finds) the person's login, then adds the membership
 * through app.add_member, which enforces who may grant which role.
 */
export async function inviteMember(m: MemberSession, input: { email: string; role: MemberRole; displayName: string | null }): Promise<string> {
  let userId: string;
  if (authMode() === "local") {
    userId = await ensureLocalUser(input.email);
  } else {
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo: `${env().APP_URL}/sign-in` });
    if (data?.user) {
      userId = data.user.id;
    } else {
      // Already has a login (for example in another business). Resolve the id
      // without emailing anything; they sign in as usual and see this business.
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email: input.email });
      if (!link.data?.user) throw new Error(error?.message ?? "The invitation could not be sent.");
      userId = link.data.user.id;
    }
  }

  return withRls(m.claims, async (tx) => {
    const result = await sql<{ id: string }>`select app.add_member(${userId}, ${input.email}, ${input.role}, ${input.displayName}) as id`.execute(tx);
    return result.rows[0]!.id;
  });
}
