import { z } from "zod";

// OPS-03: the product event catalog. The only names and props RouteVerde
// stores (data-collection contract, section 4). Each entry is a strict
// object: an unknown prop is a rejection, not a silent drop, so nothing new is
// collected without a change here and in the contract. Props are flat
// numbers, enums and short scrubbed strings; never ids, names or free text.
//
// To add events (the inventory feature, for example), add one entry below and
// a row to the contract's catalog in the same change.

/** A bounded whole number. */
const int = (min: number, max: number) => z.number().int().min(min).max(max);
/** Stops on one technician's day: the dispatch board's design ceiling is 500. */
const stops = int(0, 1000);
const position = int(1, 1000);
const engine = z.enum(["solver", "ai"]);
/** A route pattern from routePattern(): static lower-case segments and :id only. */
const route = z.string().max(120).regex(/^\/(?:(?:[a-z][a-z-]{0,39}|:id)(?:\/(?:[a-z][a-z-]{0,39}|:id))*)?$/);
const fingerprint = z.string().regex(/^[0-9a-f]{16}$/);
/** Already scrubbed by scrubMessage() (and scrubbed again on the server). */
const message = z.string().max(200);

export const EVENTS = {
  "error.client": z.strictObject({
    kind: z.enum(["error", "unhandledrejection", "boundary"]),
    fingerprint,
    message,
    route,
  }),
  "error.server": z.strictObject({
    kind: z.string().regex(/^(app|pages)_(render|route|action|proxy|unknown)$/),
    fingerprint,
    message,
    route,
    digest: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  }),
  "route.proposal_shown": z.strictObject({ engine, stops, saved_minutes: int(-1440, 1440) }),
  "route.proposal_accepted": z.strictObject({ engine, stops }),
  "route.proposal_dismissed": z.strictObject({ engine, stops }),
  "route.proposal_undone": z.strictObject({ engine }),
  "route.manual_change_after_optimize": z.strictObject({ engine }),
  "route.stop_out_of_order": z.strictObject({ published_position: position, actual_position: position, stops }),
} as const;

export type EventName = keyof typeof EVENTS;
export type EventProps<N extends EventName> = z.infer<(typeof EVENTS)[N]>;

/** Where an event came from (app.product_events.surface). */
export type Surface = "office" | "tech" | "portal" | "public" | "server" | "job";

export function isEventName(name: string): name is EventName {
  return Object.hasOwn(EVENTS, name);
}

/** OPS-03: the props, validated against the catalog; null for an unknown name or any prop the catalog does not allow. */
export function parseEvent<N extends EventName>(name: N, props: unknown): EventProps<N> | null;
export function parseEvent(name: string, props: unknown): Record<string, unknown> | null;
export function parseEvent(name: string, props: unknown): Record<string, unknown> | null {
  if (!isEventName(name)) return null;
  const parsed = EVENTS[name].safeParse(props);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

/** The engine a stored optimizer or provider name stands for: only the AI planner is "ai". */
export function engineOf(provider: string | null | undefined): "solver" | "ai" {
  return provider === "ai" ? "ai" : "solver";
}
