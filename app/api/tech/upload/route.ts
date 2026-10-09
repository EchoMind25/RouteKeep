import { apiMember, json } from "@/lib/auth/api";
import { kickOutbox } from "@/lib/messaging/kick";
import { applyMutations, NotATechnicianError } from "@/lib/server/tech-sync";
import { mutation, SYNC_PROTOCOL, uploadEnvelope, type Mutation, type MutationResult, type UploadResponse } from "@/lib/sync/protocol";

// NFR-01, NFR-02: the device's queued work, applied at most once each.
export async function POST(request: Request) {
  const member = await apiMember(request);
  if (member instanceof Response) return member;
  const body = await request.json().catch(() => null);
  const envelope = uploadEnvelope.safeParse(body);
  if (!envelope.success) return json({ error: "That upload could not be read.", issues: envelope.error.issues.slice(0, 5) }, 400);
  // NFR-02: a malformed item is refused on its own; the rest of the batch still applies.
  const valid: Mutation[] = [];
  // Per position: null for a valid item (answered by applyMutations), else its rejection, if it had a key.
  const slots: (MutationResult | null | undefined)[] = [];
  envelope.data.mutations.forEach((raw, i) => {
    const m = mutation.safeParse(raw);
    if (m.success) {
      valid.push(m.data);
      slots[i] = null;
      return;
    }
    const key = raw && typeof raw === "object" && "key" in raw && typeof raw.key === "string" ? raw.key : null;
    if (key) slots[i] = { key, status: "rejected", message: "The server could not read this change, so it was not applied. Tell the office." };
  });
  // NFR-01, D-04: applyMutations may stop early; valid items past its prefix get no
  // result (slice returns []), so they stay queued on the device.
  try {
    const applied = valid.length ? await applyMutations(member, valid) : [];
    let next = 0;
    const results = slots.flatMap((slot) => (slot === null ? applied.slice(next, ++next) : slot ? [slot] : []));
    const response: UploadResponse = { protocol: SYNC_PROTOCOL, results };
    // FR-MSG-01: "service complete" emails, once the visits are saved.
    if (response.results.some((r) => r.status === "applied")) kickOutbox(member.tenantId);
    return json(response);
  } catch (error) {
    if (error instanceof NotATechnicianError) return json({ error: error.message }, 409);
    throw error;
  }
}
