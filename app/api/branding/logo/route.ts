import { apiMember, PRIVATE } from "@/lib/auth/api";
import { withRls } from "@/lib/db/rls";
import { storage } from "@/lib/providers/storage";

// FR-BRD-02: the business's logo, for its own members to preview.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (member instanceof Response) return member;
  const tenant = await withRls(member.claims, (tx) => tx.selectFrom("tenants").select("logo_path").executeTakeFirstOrThrow());
  const file = tenant.logo_path ? await storage().get(tenant.logo_path) : null;
  if (!file) return new Response(null, { status: 404, headers: PRIVATE });
  return new Response(new Blob([new Uint8Array(file.body)], { type: file.contentType }), { headers: { ...PRIVATE, "Content-Type": file.contentType, "X-Content-Type-Options": "nosniff" } });
}
