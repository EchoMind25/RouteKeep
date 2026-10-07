import { apiMember, PRIVATE } from "@/lib/auth/api";
import { OFFICE_ROLES } from "@/lib/auth/session";
import { renderServiceRecord } from "@/lib/records/service-record-pdf";
import { readAttachment } from "@/lib/server/attachments";
import { getServiceRecord } from "@/lib/server/records";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-REC-02: the PDF service record for a completed visit.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember(request, OFFICE_ROLES);
  if (member instanceof Response) return member;
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: PRIVATE });
  const record = await getServiceRecord(member, id);
  if (!record || record.visit.status !== "completed") return new Response(null, { status: 404, headers: PRIVATE });
  const signatureRow = record.attachments.find((a) => a.kind === "signature");
  const signature = signatureRow ? await readAttachment(member, signatureRow.id) : null;
  const pdf = await renderServiceRecord(record, signature);
  const name = `service-record-${record.visit.localDate ?? "visit"}.pdf`;
  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: { ...PRIVATE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"` },
  });
}
