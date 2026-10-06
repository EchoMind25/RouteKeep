import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { getProperty } from "@/lib/server/customers";
import { PropertyForm } from "../../edit/forms";

export const metadata: Metadata = { title: "Edit address" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string; propertyId: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id, propertyId } = await params;
  if (!UUID.test(id) || !UUID.test(propertyId)) notFound();
  const p = await getProperty(member, id, propertyId);
  if (!p) notFound();
  return (
    <div className="grid gap-2">
      <PageHeader
        title="Edit address"
        back={
          <Link href={`/customers/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Back to customer
          </Link>
        }
      />
      <PropertyForm
        customerId={id}
        locked={p.location_locked}
        initial={{
          propertyId: p.id,
          version: String(p.version),
          line1: p.address_line1,
          line2: p.address_line2 ?? "",
          city: p.city,
          region: p.region,
          postalCode: p.postal_code,
          accessNotes: p.access_notes ?? "",
          sqFt: p.sq_ft ? String(p.sq_ft) : "",
          lawnAreaSqFt: p.lawn_area_sq_ft ? String(p.lawn_area_sq_ft) : "",
        }}
      />
    </div>
  );
}
