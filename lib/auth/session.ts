import "server-only";
import { sql } from "kysely";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { authMode } from "@/lib/auth-mode";
import { withRls, type DbClaims } from "@/lib/db/rls";
import { developerEmails, mfaRequired } from "@/lib/env";
import { log } from "@/lib/observability/log";
import { developerStep, isDeveloperEmail, type DeveloperStep } from "./developer";
import { readLocalSession } from "./local";
import { MFA_PATH, mfaStep, type MfaStep } from "./mfa";
import { hasVerifiedFactor, readSupabaseSession } from "./supabase";

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
const loadMember = cache(async (): Promise<MemberSession | null> => {
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

/**
 * CR-15: what an owner or admin must do before the office app opens to them;
 * "allow" for everyone else. aal comes from the verified claims, and the
 * factor list is only fetched when the session is below aal2.
 */
export const getMfaStep = cache(async (): Promise<MfaStep> => {
  const member = await loadMember();
  if (!member || !mfaRequired()) return "allow";
  const aal = member.claims.aal as string | undefined;
  const checkFactor = aal !== "aal2" && (member.role === "owner" || member.role === "admin");
  return mfaStep({ role: member.role, aal, hasVerifiedFactor: checkFactor ? await hasVerifiedFactor() : false, required: true });
});

/** The signed-in member; null when not a member or (CR-15) an owner or admin who has not completed the second factor. */
export const getMemberSession = cache(async (): Promise<MemberSession | null> => {
  const member = await loadMember();
  if (!member) return null;
  return (await getMfaStep()) === "allow" ? member : null;
});

export async function requireUser(): Promise<UserSession> {
  const user = await getUserSession();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireMember(allowed?: readonly MemberRole[]): Promise<MemberSession> {
  await requireUser();
  const step = await getMfaStep();
  if (step !== "allow") redirect(MFA_PATH[step]);
  const member = await getMemberSession();
  if (!member) redirect("/onboarding");
  if (allowed && !allowed.includes(member.role)) redirect("/app?denied=1");
  return member;
}

export const OFFICE_ROLES = ["owner", "admin", "office", "dispatcher"] as const satisfies readonly MemberRole[];
/** FR-INV: who may see inventory, forecasts and orders (matches lib/server/inventory.ts); dispatchers do not. */
export const INVENTORY_ROLES = ["owner", "admin", "office"] as const satisfies readonly MemberRole[];
export const ADMIN_ROLES = ["owner", "admin"] as const satisfies readonly MemberRole[];

export function canManage(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

/** OPS-01: a signed-in developer who has passed every check in lib/auth/developer.ts. */
export type DeveloperSession = UserSession & { email: string };

/** OPS-01: whether the signed-in user's email is on DEVELOPER_EMAILS (no second-factor check). */
export async function isDeveloperUser(): Promise<boolean> {
  const user = await getUserSession();
  return isDeveloperEmail(user?.email, developerEmails());
}

/** OPS-01: what stands between the signed-in user and the developer console. The factor list is only fetched below aal2. */
export const getDeveloperStep = cache(async (): Promise<DeveloperStep> => {
  const user = await getUserSession();
  if (!user) return "deny";
  const allowlist = developerEmails();
  if (!isDeveloperEmail(user.email, allowlist)) return "deny";
  const secondFactorAvailable = authMode() === "supabase";
  const aal = user.claims.aal as string | undefined;
  const checkFactor = secondFactorAvailable && aal !== "aal2";
  return developerStep({ email: user.email, allowlist, aal, hasVerifiedFactor: checkFactor ? await hasVerifiedFactor() : false, amr: user.claims.amr, secondFactorAvailable });
});

/**
 * OPS-01: the developer, or a redirect. Anyone else gets a plain 404, so the
 * console does not announce itself; the attempt is logged with the user id only.
 */
// Layout and page both ask; one log line per request is enough.
const logRefusal = cache((userId: string) => log.warn("developer console refused", { userId }));

export async function requireDeveloper(): Promise<DeveloperSession> {
  const user = await requireUser();
  const step = await getDeveloperStep();
  if (step === "deny") {
    logRefusal(user.userId);
    notFound();
  }
  if (step !== "allow") redirect(MFA_PATH[step]);
  return { ...user, email: user.email!.toLowerCase() };
}
