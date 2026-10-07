import "server-only";
import { createHash } from "node:crypto";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { storage } from "@/lib/providers/storage";

// Photos and signatures from the field (FR-TEC-09). The bytes go to storage,
// the row to `attachments` with the device's client key, so an upload that is
// retried after a lost answer lands once (ENG-01).

export const ATTACHMENT_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class AttachmentError extends Error {
  override name = "AttachmentError";
}

export async function saveVisitAttachment(
  m: MemberSession,
  input: { key: string; appointmentId: string; kind: "photo" | "signature"; capturedAt: Date; contentType: keyof typeof ATTACHMENT_TYPES; body: Uint8Array },
): Promise<"applied" | "duplicate"> {
  const visit = await withRls(m.claims, (tx) => tx.selectFrom("appointments").select("id").where("id", "=", input.appointmentId).executeTakeFirst());
  if (!visit) throw new AttachmentError("This visit is no longer on file.");
  // The path comes from ids the server trusts, never from the device.
  const path = `${m.tenantId}/appointments/${input.appointmentId}/${input.key}.${ATTACHMENT_TYPES[input.contentType]}`;
  await storage().put(path, input.body, input.contentType);
  const row = await withRls(m.claims, (tx) =>
    tx
      .insertInto("attachments")
      .values({
        owner_type: "appointment",
        owner_id: input.appointmentId,
        kind: input.kind,
        path,
        content_type: input.contentType,
        size_bytes: input.body.byteLength,
        sha256: createHash("sha256").update(input.body).digest("hex"),
        captured_at: input.capturedAt,
        uploaded_at: new Date(),
        client_key: input.key,
      })
      .onConflict((oc) => oc.constraint("attachments_client_key").doNothing())
      .returning("id")
      .executeTakeFirst(),
  );
  return row ? "applied" : "duplicate";
}

export async function listVisitAttachments(m: MemberSession, appointmentId: string) {
  return withRls(m.claims, (tx) =>
    tx
      .selectFrom("attachments")
      .select(["id", "kind", "content_type", "size_bytes", "captured_at"])
      .where("owner_type", "=", "appointment")
      .where("owner_id", "=", appointmentId)
      .orderBy("captured_at")
      .execute(),
  );
}

/** The file, if the caller may see the row (RLS decides). */
export async function readAttachment(m: MemberSession, id: string) {
  const row = await withRls(m.claims, (tx) => tx.selectFrom("attachments").select(["path", "content_type"]).where("id", "=", id).executeTakeFirst());
  if (!row) return null;
  const file = await storage().get(row.path);
  return file ? { body: file.body, contentType: row.content_type } : null;
}
