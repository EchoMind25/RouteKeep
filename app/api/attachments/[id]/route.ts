import { apiMember, PRIVATE } from "@/lib/auth/api";
import { readAttachment } from "@/lib/server/attachments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A visit's photo or signature, for anyone in the business who may see the visit.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember(request);
  if (member instanceof Response) return member;
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const file = await readAttachment(member, id);
  if (!file) return new Response(null, { status: 404, headers: PRIVATE });
  return new Response(new Blob([new Uint8Array(file.body)], { type: file.contentType }), {
    // NFR-03: an attachment's bytes never change (the path is its client key),
    // so the browser keeps it; still private, never on a shared cache.
    headers: { "Cache-Control": "private, max-age=31536000, immutable", "Content-Type": file.contentType, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" },
  });
}
