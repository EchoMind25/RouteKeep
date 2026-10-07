import { apiMember, PRIVATE } from "@/lib/auth/api";
import { isEnabled } from "@/lib/flags";
import { problemRowsCsv } from "@/lib/server/imports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-MIG-11: only the rows that need fixing, with a reason column.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled("migration")) return new Response(null, { status: 404, headers: PRIVATE });
  const member = await apiMember(request, ["owner", "admin"]);
  if (member instanceof Response) return member;
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const csv = await problemRowsCsv(member, id).catch(() => null);
  if (csv === null) return new Response(null, { status: 404, headers: PRIVATE });
  return new Response(csv, { headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rows-to-fix.csv"' } });
}
