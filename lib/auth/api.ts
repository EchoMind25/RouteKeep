import "server-only";
import { NextResponse } from "next/server";
import { getMemberSession, type MemberRole, type MemberSession } from "./session";

// Route handlers answer in JSON: a background sync cannot follow a redirect to
// the sign-in page the way a person can.

/** Private, never cached: not by the browser, not by the service worker, not by a CDN. */
export const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE });
}

// "Origin: null" (sandboxed frames, some redirects) is not a URL; refuse it
// as cross-site instead of throwing a 500.
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** The caller as a member, or the JSON response to send instead. */
export async function apiMember(request: Request, allowed?: readonly MemberRole[]): Promise<MemberSession | NextResponse> {
  // Cookies are SameSite=Lax already; refusing other origins outright is belt
  // and braces. Compare with the Host the browser used (request.url carries
  // the server's own idea of its address, which differs behind a proxy).
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && (!host || originHost(origin) !== host)) return json({ error: "Cross-site requests are not accepted." }, 403);
  const member = await getMemberSession();
  if (!member) return json({ error: "Sign in again to sync." }, 401);
  if (allowed && !allowed.includes(member.role)) return json({ error: "Your role cannot do this." }, 403);
  return member;
}
