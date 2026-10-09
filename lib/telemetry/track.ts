import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withAnon, withPortal, withRls, type PortalClaims, type Tx } from "@/lib/db/rls";
import { errorText, log } from "@/lib/observability/log";
import { publicEnv } from "@/lib/public-env";
import { parseEvent, type EventName, type EventProps, type Surface } from "./events";

// OPS-03, OPS-04: the one way request code records a product event. The
// business and its data-sharing level are resolved by app.track_event from
// the caller's own role and claims, never from an argument, so a business at
// `none` is dropped by the database whatever the app does.
//
// Every call is its OWN short transaction, made after the caller's business
// transaction has committed: telemetry can never roll back real work, and a
// failure here is logged once and swallowed. Never throws.

/** Who is calling: a member, a signed-in portal customer, or nobody (public site, signed-out pages). */
export type TrackContext = MemberSession | PortalClaims | "anon";

const warned = new Set<string>();
/** One log line per problem per server instance: a broken gate must not flood the logs. */
export function warnOnce(key: string, fields: Record<string, unknown> = {}): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn("telemetry dropped", { reason: key, ...fields });
}

/** The deployed build's id (next.config.ts sets it from COMMIT_REF), or null if it is not a plain token. */
export function appVersion(): string | null {
  const v = publicEnv.appVersion;
  return /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : null;
}

function isPortal(ctx: Exclude<TrackContext, "anon">): ctx is PortalClaims {
  return (ctx as PortalClaims).role === "portal" && typeof (ctx as PortalClaims).portal_tenant_id === "string";
}

/** office or tech from the member's role; portal for a portal customer; public when nobody is signed in. */
export function surfaceOf(ctx: TrackContext): Surface {
  if (ctx === "anon") return "public";
  if (isPortal(ctx)) return "portal";
  return ctx.role === "technician" ? "tech" : "office";
}

export async function insertEvent(tx: Tx, name: string, props: Record<string, unknown>, surface: Surface, tenantId: string | null = null): Promise<boolean> {
  const r = await sql<{ stored: boolean }>`select app.track_event(${name}, ${JSON.stringify(props)}::jsonb, ${surface}, ${appVersion()}, ${tenantId}::uuid) as stored`.execute(tx);
  return r.rows[0]?.stored === true;
}

/**
 * OPS-03: record one event. Props are checked against the catalog
 * (lib/telemetry/events.ts) first; anything not in it is refused here.
 * Resolves true when a row was stored (false at `none`, on refusal or on error).
 */
export async function track<N extends EventName>(ctx: TrackContext, name: N, props: EventProps<N>, opts: { surface?: Surface } = {}): Promise<boolean> {
  try {
    const clean = parseEvent(name, props);
    if (!clean) {
      warnOnce(`invalid props for ${name}`);
      return false;
    }
    const surface = opts.surface ?? surfaceOf(ctx);
    const run = (tx: Tx) => insertEvent(tx, name, clean, surface);
    if (ctx === "anon") return await withAnon(run);
    if (isPortal(ctx)) return await withPortal(ctx, run);
    return await withRls(ctx.claims, run);
  } catch (error) {
    warnOnce(`track failed for ${name}`, { error: errorText(error).slice(0, 200) });
    return false;
  }
}
