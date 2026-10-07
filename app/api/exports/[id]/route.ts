import { apiMember, PRIVATE } from "@/lib/auth/api";
import { exportFile } from "@/lib/server/exports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-EXP-02: the export, to the owner or an admin, while the link is valid.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember(request, ["owner", "admin"]);
  if (member instanceof Response) return member;
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const file = await exportFile(member, id);
  if (!file) return new Response("This export has expired or is not ready. Start a new one from Settings, Export.", { status: 404, headers: { ...PRIVATE, "Content-Type": "text/plain" } });
  return new Response(new Blob([new Uint8Array(file.body)], { type: "application/zip" }), {
    headers: { ...PRIVATE, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${file.name}"` },
  });
}
