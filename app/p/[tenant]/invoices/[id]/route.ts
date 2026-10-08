import { NextResponse } from "next/server";
import { PRIVATE } from "@/lib/auth/api";
import { storage } from "@/lib/providers/storage";
import { portalInvoice } from "@/lib/portal/data";
import { portalSession } from "@/lib/portal/session";
import { renderInvoice } from "@/lib/records/invoice-pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-POR-02, FR-BRD-01: the customer's own invoice, with the business's logo.
export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  if (!UUID.test(tenant) || !UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const claims = await portalSession(tenant);
  if (!claims) return new NextResponse(null, { status: 303, headers: { Location: `/p/${tenant}` } });
  const invoice = await portalInvoice(claims, id);
  if (!invoice || invoice.status === "draft") return new Response(null, { status: 404, headers: PRIVATE });
  const logo = invoice.business.logoPath ? await storage().get(invoice.business.logoPath).catch(() => null) : null;
  const pdf = await renderInvoice(invoice, logo);
  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: { ...PRIVATE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice-${invoice.number}.pdf"` },
  });
}
