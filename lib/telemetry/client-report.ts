import { parseEvent, type EventProps } from "./events";
import { routePattern, scrubMessage } from "./scrub";

// OPS-03: reading a browser error report. Pure so it is unit tested. The
// browser has already scrubbed, but its work is never trusted: the message
// and route are scrubbed again here and the result re-checked against the catalog.

export const MAX_REPORT_BYTES = 4 * 1024;

/** True when a declared or actual size is over the limit. */
export function tooLarge(bytes: number): boolean {
  return !Number.isFinite(bytes) || bytes > MAX_REPORT_BYTES;
}

export function parseClientReport(text: string): EventProps<"error.client"> | null {
  if (tooLarge(new TextEncoder().encode(text).length)) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const first = parseEvent("error.client", body);
  if (!first) return null;
  return parseEvent("error.client", { ...first, message: scrubMessage(first.message), route: routePattern(first.route) });
}

/** Reads a request body, giving up (null) as soon as it passes the limit. */
export async function readLimited(body: ReadableStream<Uint8Array> | null, limit = MAX_REPORT_BYTES): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
