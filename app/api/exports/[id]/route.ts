import { apiMember, PRIVATE } from "@/lib/auth/api";
import { storage } from "@/lib/providers/storage";
import { exportFile } from "@/lib/server/exports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SECONDS = 300;

// FR-EXP-02: the export, to the owner or an admin, while the link is valid.
// Hosted functions cap a response at about 6 MB, so the browser is sent to a
// short-lived signed storage address instead of being handed the bytes.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember(request, ["owner", "admin"]);
  if (member instanceof Response) return member;
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const gone = () => new Response("This export has expired or is not ready. Start a new one from Settings, Export.", { status: 404, headers: { ...PRIVATE, "Content-Type": "text/plain" } });
  const file = await exportFile(member, id);
  if (!file) return gone();
  const url = await storage().signedUrl(file.path, LINK_SECONDS, file.name);
  if (url) return new Response(null, { status: 303, headers: { ...PRIVATE, Location: url } });
  // Local development has no signed addresses: stream it from here.
  const stored = await storage().get(file.path);
  if (!stored) return gone();
  return new Response(new Blob([new Uint8Array(stored.body)], { type: "application/zip" }), {
    headers: { ...PRIVATE, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${file.name}"` },
  });
}
