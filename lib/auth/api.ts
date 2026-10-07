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

/** The caller as a member, or the JSON response to send instead. */
export async function apiMember(request: Request, allowed?: readonly MemberRole[]): Promise<MemberSession | NextResponse> {
  // Cookies are SameSite=Lax already; refusing other origins outright is belt and braces.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Cross-site requests are not accepted." }, 403);
  const member = await getMemberSession();
  if (!member) return json({ error: "Sign in again to sync." }, 401);
  if (allowed && !allowed.includes(member.role)) return json({ error: "Your role cannot do this." }, 403);
  return member;
}
