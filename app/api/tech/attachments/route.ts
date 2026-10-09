import { z } from "zod";
import { apiMember, json } from "@/lib/auth/api";
import { ATTACHMENT_TYPES, AttachmentError, MAX_ATTACHMENT_BYTES, saveVisitAttachment } from "@/lib/server/attachments";
import { clientKey } from "@/lib/sync/protocol";

// FR-TEC-09: a photo or signature taken on the device, sent once it is safe to.
const fields = z.object({
  key: clientKey,
  appointmentId: z.uuid(),
  kind: z.enum(["photo", "signature"]),
  capturedAt: z.iso.datetime({ offset: true }),
});

export async function POST(request: Request) {
  const member = await apiMember(request);
  if (member instanceof Response) return member;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const parsed = fields.safeParse(form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : null);
  if (!parsed.success || !(file instanceof File)) return json({ error: "That upload could not be read." }, 400);
  if (!(file.type in ATTACHMENT_TYPES)) return json({ error: "Photos must be JPEG, PNG or WebP." }, 415);
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) return json({ error: "Photos must be under 5 MB." }, 413);
  try {
    const status = await saveVisitAttachment(member, {
      ...parsed.data,
      capturedAt: new Date(parsed.data.capturedAt),
      contentType: file.type as keyof typeof ATTACHMENT_TYPES,
      body: new Uint8Array(await file.arrayBuffer()),
    });
    return json({ key: parsed.data.key, status });
  } catch (error) {
    if (error instanceof AttachmentError) return json({ key: parsed.data.key, status: "rejected", error: error.message }, 422);
    throw error;
  }
}
