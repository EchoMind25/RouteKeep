import { PRIVATE } from "@/lib/auth/api";
import { log } from "@/lib/observability/log";

// NFR-06: browsers post Content-Security-Policy violations here while the
// policy is report-only (proxy.ts). Anonymous by nature, so it only logs one
// truncated line; a body over 8 KB is dropped unread.
const MAX_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return new Response(null, { status: 204, headers: PRIVATE });
  const text = (await request.text().catch(() => "")).slice(0, MAX_BYTES);
  log.warn("csp violation", { report: text.slice(0, 1000) });
  return new Response(null, { status: 204, headers: PRIVATE });
}
