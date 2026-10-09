import { getMemberSession, getUserSession } from "@/lib/auth/session";
import { handleClientReport } from "@/lib/telemetry/endpoint";

// OPS-03, OPS-04: browser error reports from the office, the technician app
// and the public site. A signed-in member's report goes through their own
// business's data-sharing gate; a signed-in user whose business cannot be
// resolved (second factor pending, membership revoked) is dropped rather than
// filed as anonymous; nobody signed in is anonymous with surface "public".
export async function POST(request: Request) {
  return handleClientReport(request, async () => {
    const member = await getMemberSession();
    if (member) return member;
    const user = await getUserSession();
    return user?.claims.tenant_id ? null : "anon";
  });
}
