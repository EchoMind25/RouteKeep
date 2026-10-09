// OPS-03: scrubbing for error reports, shared by the browser reporter and the
// server (which scrubs again: it never trusts the browser's work). Pure, no
// Node APIs, so the same code runs in both. Contract section 2: no emails,
// phone numbers, long digit runs, ids or quoted values; 200 characters at most.

export const MAX_MESSAGE = 200;

const PG_KEY_DETAIL = /\([^()]*\)=\([^()]*\)/g;
const URL_QUERY = /((?:https?:\/\/|\/)[^\s?#"'`<>]*)[?#][^\s"'`<>]*/g;
const QUOTED = /"[^"]*"|`[^`]*`|“[^”]*”|‘[^’]*’|(^|[\s(=:,[{])'[^']*'/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Tokens, hashes and other long opaque values: 20+ characters with a digit in them.
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g;
const PHONE = /(?:\+|\()?\d[\d\s().-]{6,}\d/g;
const DIGITS = /\d{4,}/g;

/** A message with personal data and identifiers removed, whitespace collapsed, at most 200 characters. */
export function scrubMessage(input: unknown): string {
  let s = typeof input === "string" ? input : input instanceof Error ? input.message : String(input ?? "");
  s = s.slice(0, 4000);
  s = s
    .replace(PG_KEY_DETAIL, "(?)=(?)")
    .replace(URL_QUERY, "$1")
    .replace(QUOTED, (_m, lead: string | undefined) => `${lead ?? ""}"?"`)
    .replace(EMAIL, "<email>")
    .replace(UUID, "<id>")
    .replace(TOKEN, "<id>")
    .replace(PHONE, "<phone>")
    .replace(DIGITS, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE) : s;
}

// A path segment survives only if it looks like a route name we wrote: lower-case
// letters and hyphens. Anything else (ids, uuids, digits, tokens, slugs with
// capitals) becomes :id, so a pattern can never carry a value.
const STATIC_SEGMENT = /^[a-z][a-z-]{0,39}$/;
const MAX_SEGMENTS = 12;

/** A path as a pattern: /customers/3f2c.../edit?tab=1 becomes /customers/:id/edit. */
export function routePattern(path: string): string {
  let p = typeof path === "string" ? path : "";
  const scheme = p.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i);
  if (scheme) p = p.slice(scheme[0].length);
  p = p.split(/[?#]/, 1)[0] ?? "";
  const segments = p
    .split("/")
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS)
    .map((seg) => (STATIC_SEGMENT.test(seg) ? seg : ":id"));
  const out = `/${segments.join("/")}`;
  return out.length > 120 ? out.slice(0, 120).replace(/\/[^/]*$/, "") || "/" : out;
}

/** The first frame of a stack that is our code, with origin, query and line/column numbers removed. */
export function firstAppFrame(stack: string | undefined | null): string {
  if (!stack) return "";
  const lines = String(stack).split("\n").slice(0, 40);
  const frame =
    lines.find((l) => /(_next\/|webpack-internal|\/app\/|\/lib\/|\/components\/|\.next\/server)/.test(l) && !/node_modules/.test(l)) ??
    lines.find((l) => /^\s*at\s|@/.test(l)) ??
    "";
  return frame
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^/\s)]*/gi, "")
    .replace(/[?#][^\s):]*/g, "")
    .replace(/:\d+(:\d+)?/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** 32-bit FNV-1a; two seeds give 16 hex characters. Not cryptographic: it only groups reports. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** OPS-03: a stable short id for "the same error": kind, scrubbed message and the first app frame. */
export function fingerprint(kind: string, message: unknown, stack?: string | null): string {
  const text = `${kind}|${scrubMessage(message)}|${firstAppFrame(stack)}`;
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193 ^ 0x9e3779b9);
}
