import "server-only";
import { cookies } from "next/headers";
import type { PortalClaims } from "@/lib/db/rls";
import { appSecret, env } from "@/lib/env";
import { purposeKey, sign, verify } from "@/lib/messaging/signed";

// FR-POR-01: a customer signs in with a one-time emailed link; the session is
// a signed cookie scoped to that business's portal path, 30 days.

const DAYS = 30;
// Signed with its own derived key: unsubscribe links carry the same {t, c}
// and are signed with APP_SECRET itself, so they must never pass as a session.
const sessionKey = (secret: string) => purposeKey(secret, "portal-session-v1");
const name = (tenantId: string) => `rk_portal_${tenantId.slice(0, 8)}`;

interface Session {
  t: string;
  c: string;
  exp: number;
}

export async function portalSession(tenantId: string): Promise<PortalClaims | null> {
  const secret = appSecret();
  if (!secret) return null;
  const s = verify<Session>((await cookies()).get(name(tenantId))?.value, sessionKey(secret));
  if (!s || s.t !== tenantId || typeof s.exp !== "number") return null;
  return { role: "portal", portal_tenant_id: s.t, portal_customer_id: s.c };
}

/** The session cookie, for the response that completes sign-in to set. */
export function portalCookie(tenantId: string, customerId: string) {
  const secret = appSecret();
  if (!secret) throw new Error("APP_SECRET is not set");
  return {
    name: name(tenantId),
    value: sign({ t: tenantId, c: customerId, exp: Math.floor(Date.now() / 1000) + DAYS * 86_400 }, sessionKey(secret)),
    options: { httpOnly: true, sameSite: "lax" as const, secure: env().APP_URL.startsWith("https://"), path: `/p/${tenantId}`, maxAge: DAYS * 86_400 },
  };
}

export async function endPortalSession(tenantId: string) {
  (await cookies()).set(name(tenantId), "", { path: `/p/${tenantId}`, maxAge: 0 });
}
