import "server-only";
import { sql } from "kysely";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authMode } from "@/lib/auth-mode";
import { withRls, type DbClaims } from "@/lib/db/rls";
import { readLocalSession } from "./local";
import { readSupabaseSession } from "./supabase";

export const MEMBER_ROLES = ["owner", "admin", "office", "dispatcher", "technician"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface UserSession {
  userId: string;
  email: string | null;
  claims: DbClaims;
}

export interface MemberSession extends UserSession {
  tenantId: string;
  tenantName: string;
  timezone: string;
  role: MemberRole;
}

/** The signed-in user, from a verified token. Cached per request. */
export const getUserSession = cache(async (): Promise<UserSession | null> =>
  authMode() === "local" ? readLocalSession() : readSupabaseSession(),
);

/**
 * The user's tenant and role as the database sees them right now. The token's
 * tenant claim is only a hint: a revoked or demoted member is caught here on
 * their next request, not when the token expires.
 */
export const getMemberSession = cache(async (): Promise<MemberSession | null> => {
  const user = await getUserSession();
  if (!user?.claims.tenant_id) return null;
  const row = await withRls(user.claims, (tx) =>
    tx
      .selectFrom("tenants")
      .select(["id", "name", "timezone"])
      .select(sql<string | null>`app.current_member_role()`.as("role"))
      .where("id", "=", user.claims.tenant_id!)
      .executeTakeFirst(),
  );
  if (!row?.role) return null;
  return { ...user, tenantId: row.id, tenantName: row.name, timezone: row.timezone, role: row.role as MemberRole };
});

export async function requireUser(): Promise<UserSession> {
  const user = await getUserSession();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireMember(allowed?: readonly MemberRole[]): Promise<MemberSession> {
  await requireUser();
  const member = await getMemberSession();
  if (!member) redirect("/onboarding");
  if (allowed && !allowed.includes(member.role)) redirect("/?denied=1");
  return member;
}

export const OFFICE_ROLES = ["owner", "admin", "office", "dispatcher"] as const satisfies readonly MemberRole[];
export const ADMIN_ROLES = ["owner", "admin"] as const satisfies readonly MemberRole[];

export function canManage(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}
