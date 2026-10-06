import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { listServiceTypes, listTechnicians } from "@/lib/server/catalog";
import { getCustomer, propertyAddress } from "@/lib/server/customers";
import { OneOffVisitForm } from "./visit-form";

export const metadata: Metadata = { title: "New visit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-SUB-04: a visit with no plan behind it.
export default async function NewVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [data, types, technicians] = await Promise.all([getCustomer(member, id), listServiceTypes(member), listTechnicians(member, { activeOnly: true })]);
  if (!data) notFound();

  return (
    <div className="grid gap-2">
      <PageHeader
        title="One-off visit"
        description={`For ${data.customer.display_name}. Callbacks, one-time treatments and inspections.`}
        back={
          <Link href={`/customers/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> {data.customer.display_name}
          </Link>
        }
      />
      <OneOffVisitForm
        customerId={id}
        clientKey={crypto.randomUUID()}
        properties={data.properties.map((p) => ({ id: p.id, label: propertyAddress(p) }))}
        serviceTypes={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))}
        technicians={technicians.map((t) => ({ id: t.id, name: t.display_name }))}
        today={todayIn(member.timezone)}
      />
    </div>
  );
}
