import { PRIVATE } from "@/lib/auth/api";
import { isEnabled } from "@/lib/flags";
import { portalSession } from "@/lib/portal/session";
import { handleClientReport } from "@/lib/telemetry/endpoint";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// OPS-03, OPS-04: browser error reports from the customer portal. The portal
// session cookie is scoped to /p/<business>, so it arrives here and not at
// /api/telemetry. Only a signed-in customer's report is kept, through that
// business's data-sharing gate; the signed-out portal does not load the reporter.
export async function POST(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!isEnabled("portal") || !UUID.test(tenant)) return new Response(null, { status: 204, headers: PRIVATE });
  return handleClientReport(request, async () => portalSession(tenant));
}
