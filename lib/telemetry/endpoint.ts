import "server-only";
import { PRIVATE } from "@/lib/auth/api";
import { sql } from "kysely";
import { withAnon } from "@/lib/db/rls";
import { parseClientReport, readLimited, tooLarge } from "./client-report";
import { track, type TrackContext } from "./track";

// OPS-03: the browser error report endpoint, shared by /api/telemetry and the
// portal's /p/[tenant]/telemetry (the portal session cookie is scoped to the
// portal's path, so portal pages report there). Always answers 204: the
// browser learns nothing about whether, or how, a report was kept.

/** Fixed windows in app.rate_limit_hit. No IP is stored: the key is the business, or one shared key for everyone signed out. */
const HOUR = 3600;
const PER_TENANT = 120;
const PUBLIC = 600;

async function withinRateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  return withAnon(async (tx) => (await sql<{ ok: boolean }>`select app.rate_limit_hit(${key}, ${windowSeconds}::int, ${max}::int) as ok`.execute(tx)).rows[0]?.ok === true);
}

function done(): Response {
  return new Response(null, { status: 204, headers: PRIVATE });
}

function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * resolve() names the caller: a member, a portal customer, "anon" for nobody
 * signed in, or null to drop the report (a session that cannot be resolved is
 * never filed as anonymous: that could store data from a business at `none`).
 */
export async function handleClientReport(request: Request, resolve: () => Promise<TrackContext | null>): Promise<Response> {
  try {
    if (!sameSite(request)) return done();
    const declared = request.headers.get("content-length");
    if (declared !== null && tooLarge(Number(declared))) return done();
    const text = await readLimited(request.body);
    if (text === null) return done();
    const props = parseClientReport(text);
    if (!props) return done();
    const ctx = await resolve();
    if (!ctx) return done();
    const key = ctx === "anon" ? "telemetry:public" : `telemetry:t:${"tenantId" in ctx ? ctx.tenantId : ctx.portal_tenant_id}`;
    if (!(await withinRateLimit(key, HOUR, ctx === "anon" ? PUBLIC : PER_TENANT))) return done();
    await track(ctx, "error.client", props);
  } catch {
    // Reporting an error must never become one.
  }
  return done();
}
