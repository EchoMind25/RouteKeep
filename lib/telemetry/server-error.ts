import "server-only";
import { getMemberSession, getUserSession } from "@/lib/auth/session";
import { errorText } from "@/lib/observability/log";
import { portalSession } from "@/lib/portal/session";
import { fingerprint, routePattern, scrubMessage } from "./scrub";
import { track, warnOnce, type TrackContext } from "./track";

// OPS-03, OPS-04: server request failures as error.server, from
// instrumentation.ts (onRequestError). The business comes from the session
// when one can be read; when the request carried a session we cannot resolve
// here, the report is dropped rather than misattributed or filed anonymously.

interface RequestInfo {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ContextInfo {
  routerKind?: string;
  routeType?: string;
}

const SESSION_COOKIE = /(?:^|;\s*)(rk_local_session|sb-[^=]*-auth-token[^=]*|rk_portal_[^=]*)=/;
// Paths that always belong to some business even with no session cookie:
// the customer portal, unsubscribe links, webhooks and jobs. Errors there
// cannot be checked against that business's setting, so they are dropped
// (contract section 1: a business at none sends nothing, signed in or not).
const BUSINESS_PATH = /^\/(?:p|u)\/|^\/api\/(?:webhooks|inngest|cron)(?:\/|$|\?)/;
const PORTAL_PATH = /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$|\?)/i;

function header(h: RequestInfo["headers"], name: string): string {
  const v = h?.[name];
  return Array.isArray(v) ? v.join("; ") : (v ?? "");
}

/** The caller, "anon" for nobody signed in, or null when a session exists but cannot be resolved. */
export async function resolveCaller(request: RequestInfo): Promise<TrackContext | null> {
  const hasSession = SESSION_COOKIE.test(header(request.headers, "cookie"));
  if (!hasSession) return BUSINESS_PATH.test(request.path ?? "") ? null : "anon";
  try {
    const portal = request.path.match(PORTAL_PATH)?.[1];
    if (portal) return (await portalSession(portal)) ?? null;
    const member = await getMemberSession();
    if (member) return member;
    const user = await getUserSession();
    // Signed in but in no business yet (onboarding): nothing to attribute.
    return user && !user.claims.tenant_id ? "anon" : null;
  } catch {
    return null;
  }
}

function kindOf(context: ContextInfo): string {
  const router = context?.routerKind === "Pages Router" ? "pages" : "app";
  const type = ["render", "route", "action", "proxy"].includes(context?.routeType ?? "") ? context.routeType : "unknown";
  return `${router}_${type}`;
}

// Per server instance: one report per fingerprint per hour, at most 60 an hour
// in all, so a crawler hitting a broken page or a failing sync route writes a
// handful of rows, not one per request. Instances are short-lived; that is fine.
const HOUR_MS = 3_600_000;
const MAX_PER_HOUR = 60;
let windowStart = 0;
const seen = new Set<string>();

/** True the first time a fingerprint is seen this hour, while under the hourly cap. */
export function firstThisHour(fp: string, now = Date.now()): boolean {
  if (now - windowStart >= HOUR_MS) {
    windowStart = now;
    seen.clear();
  }
  if (seen.has(fp) || seen.size >= MAX_PER_HOUR) return false;
  seen.add(fp);
  return true;
}

export async function reportServerError(error: unknown, request: RequestInfo, context: ContextInfo): Promise<void> {
  try {
    // Telemetry's own failures are logged by track(); never report them in a loop.
    if (request?.path?.startsWith("/api/telemetry")) return;
    const raw = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const kind = kindOf(context);
    const fp = fingerprint(kind, raw, stack);
    // Before any session lookup or database work.
    if (!firstThisHour(fp)) return;
    const ctx = await resolveCaller(request);
    if (!ctx) return;
    const d = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";
    const digest = /^[A-Za-z0-9_-]{1,40}$/.test(d) ? d : undefined;
    await track(
      ctx,
      "error.server",
      { kind, fingerprint: fp, message: scrubMessage(raw), route: routePattern(request?.path ?? "/"), ...(digest ? { digest } : {}) },
      { surface: "server" },
    );
  } catch (e) {
    warnOnce("server error report failed", { error: errorText(e).slice(0, 200) });
  }
}
