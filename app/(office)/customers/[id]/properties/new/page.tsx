import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { PropertyForm } from "../../edit/forms";

export const metadata: Metadata = { title: "Add address" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-CRM-01: multiple properties per customer.
export default async function NewPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const customer = await withRls(member.claims, (tx) => tx.selectFrom("customers").select(["id", "display_name"]).where("id", "=", id).executeTakeFirst());
  if (!customer) notFound();
  return (
    <div className="grid gap-2">
      <PageHeader
        title="Add an address"
        description={`Another property for ${customer.display_name}, such as a rental or a second business location.`}
        back={
          <Link href={`/customers/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> {customer.display_name}
          </Link>
        }
      />
      <PropertyForm customerId={id} />
    </div>
  );
}
