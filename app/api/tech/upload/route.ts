import { apiMember, json } from "@/lib/auth/api";
import { kickOutbox } from "@/lib/messaging/kick";
import { applyMutations, NotATechnicianError } from "@/lib/server/tech-sync";
import { SYNC_PROTOCOL, uploadRequest, type UploadResponse } from "@/lib/sync/protocol";

// NFR-01, NFR-02: the device's queued work, applied at most once each.
export async function POST(request: Request) {
  const member = await apiMember(request);
  if (member instanceof Response) return member;
  const body = await request.json().catch(() => null);
  const parsed = uploadRequest.safeParse(body);
  if (!parsed.success) return json({ error: "That upload could not be read.", issues: parsed.error.issues.slice(0, 5) }, 400);
  try {
    const response: UploadResponse = { protocol: SYNC_PROTOCOL, results: await applyMutations(member, parsed.data.mutations) };
    // FR-MSG-01: "service complete" emails, once the visits are saved.
    if (response.results.some((r) => r.status === "applied")) kickOutbox(member.tenantId);
    return json(response);
  } catch (error) {
    if (error instanceof NotATechnicianError) return json({ error: error.message }, 409);
    throw error;
  }
}
