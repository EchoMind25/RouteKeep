import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Alert, PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { getAmendableRecord } from "@/lib/server/records";
import { formatInstant } from "@/lib/ui/format";
import { AmendForm } from "./form";

export const metadata: Metadata = { title: "Amend record" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (n: number | null) => (n === null ? "" : String(n));

// FR-REC-03: records are not edited; a correction is a new version with a reason.
export default async function AmendRecordPage({ params }: { params: Promise<{ id: string; recordId: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id, recordId } = await params;
  if (!UUID.test(id) || !UUID.test(recordId)) notFound();
  const amendable = await getAmendableRecord(member, recordId);
  if (!amendable || (amendable.appointmentId && amendable.appointmentId !== id)) notFound();
  const { record } = amendable;
  const back = (
    <Link href={`/schedule/visits/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
      <ArrowLeft size={14} aria-hidden /> Visit
    </Link>
  );

  if (!amendable.current) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Amend record" back={back} />
        <Alert tone="warning">This version has been amended since. Open the visit and amend the latest version.</Alert>
      </div>
    );
  }

  const products = amendable.products.map((p) => ({
    id: p.id,
    label: `${p.name}${p.epaRegNo ? `, EPA ${p.epaRegNo}` : ""}${p.active ? "" : " (retired)"}`,
  }));
  // A record whose product left the catalog still shows what it says until another is chosen.
  if (record.productId && !products.some((p) => p.id === record.productId)) products.unshift({ id: record.productId, label: record.productName });

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Amend ${record.productName}`}
        description={`${amendable.customerName ?? "Record"}, recorded ${formatInstant(record.recordedAt, amendable.timeZone)}. The record as it stands stays on file; the amendment becomes the current version.`}
        back={back}
      />
      <AmendForm
        visitId={id}
        products={products}
        initial={{
          recordId: record.id,
          key: `amend-${randomUUID()}`,
          productId: record.productId ?? "",
          mixRate: text(record.mixRate),
          mixUnit: record.mixUnit ?? "",
          totalAmount: text(record.totalAmount),
          amountUnit: record.amountUnit ?? "",
          areaTreated: text(record.areaTreated),
          areaUnit: record.areaUnit ?? "",
          targetSites: record.targetSites.join(", "),
          targetPests: record.targetPests.join(", "),
          appliedDate: amendable.applied?.date ?? "",
          appliedTime: amendable.applied?.time ?? "",
          statementDate: amendable.statement?.date ?? "",
          statementTime: amendable.statement?.time ?? "",
          reason: "",
        }}
      />
    </div>
  );
}
