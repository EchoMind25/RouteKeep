import "server-only";
import { headers } from "next/headers";

// NFR-06: one JSON line per event, no vendor. proxy.ts sets x-request-id
// (Netlify's x-nf-request-id when present), so a line can be tied to a request.
// Outside a request (jobs, tests) requestId is null.

type Level = "info" | "warn" | "error";

/** An error as text, so a thrown value serialises as something readable. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestId(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id");
  } catch {
    return null;
  }
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  void requestId().then((id) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, requestId: id, ...fields });
    (level === "info" ? console.log : level === "warn" ? console.warn : console.error)(line);
  });
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
