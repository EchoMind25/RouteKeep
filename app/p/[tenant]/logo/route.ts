import { publicBusiness } from "@/lib/portal/data";
import { storage } from "@/lib/providers/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-BRD-03: the business's logo at the top of its own portal. Logos are not
// secret; the path comes from the database, never from the request.
export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID.test(tenant)) return new Response(null, { status: 404 });
  const business = await publicBusiness(tenant);
  const file = business?.logoPath ? await storage().get(business.logoPath).catch(() => null) : null;
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Blob([new Uint8Array(file.body)], { type: file.contentType }), { headers: { "Content-Type": file.contentType, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
