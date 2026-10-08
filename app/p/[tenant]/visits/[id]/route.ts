import { NextResponse } from "next/server";
import { PRIVATE } from "@/lib/auth/api";
import { storage } from "@/lib/providers/storage";
import { portalRecord, portalSignature } from "@/lib/portal/data";
import { portalSession } from "@/lib/portal/session";
import { renderServiceRecord } from "@/lib/records/service-record-pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-POR-02, FR-REC-02, CR-16: the customer's own service record.
export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  if (!UUID.test(tenant) || !UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const claims = await portalSession(tenant);
  if (!claims) return new NextResponse(null, { status: 303, headers: { Location: `/p/${tenant}` } });
  const record = await portalRecord(claims, id);
  if (!record || record.visit.status !== "completed") return new Response(null, { status: 404, headers: PRIVATE });
  const path = await portalSignature(claims, id);
  const signature = path ? await storage().get(path).catch(() => null) : null;
  const pdf = await renderServiceRecord(record, signature ? { body: signature.body, contentType: signature.contentType } : null);
  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: { ...PRIVATE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="service-record-${record.visit.localDate ?? "visit"}.pdf"` },
  });
}
