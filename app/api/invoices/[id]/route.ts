import { apiMember, PRIVATE } from "@/lib/auth/api";
import { isEnabled } from "@/lib/flags";
import { renderInvoice } from "@/lib/records/invoice-pdf";
import { storage } from "@/lib/providers/storage";
import { getInvoice } from "@/lib/server/billing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-BRD-01: the invoice PDF, with the business's logo and nothing of ours.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled("billing")) return new Response(null, { status: 404, headers: PRIVATE });
  const member = await apiMember(request, ["owner", "admin", "office"]);
  if (member instanceof Response) return member;
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const invoice = await getInvoice(member, id);
  if (!invoice) return new Response(null, { status: 404, headers: PRIVATE });
  const logo = invoice.business.logoPath ? await storage().get(invoice.business.logoPath).catch(() => null) : null;
  const pdf = await renderInvoice(invoice, logo);
  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: { ...PRIVATE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice-${invoice.number}.pdf"` },
  });
}
