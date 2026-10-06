import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { formatPhone } from "@/lib/domain/contact";
import { getCustomer } from "@/lib/server/customers";
import { CustomerEditForm } from "./forms";

export const metadata: Metadata = { title: "Edit customer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getCustomer(member, id);
  if (!data) notFound();
  const c = data.customer;

  return (
    <div className="grid gap-2">
      <PageHeader
        title={`Edit ${c.display_name}`}
        back={
          <Link href={`/customers/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> {c.display_name}
          </Link>
        }
      />
      <CustomerEditForm
        initial={{
          id: c.id,
          version: String(c.version),
          kind: c.kind,
          firstName: c.first_name ?? "",
          lastName: c.last_name ?? "",
          companyName: c.company_name ?? "",
          email: c.email ?? "",
          phone: formatPhone(c.phone),
          smsConsent: c.sms_consent_at && !c.sms_opted_out_at ? "on" : "",
          emailOptIn: c.email_opt_in ? "on" : "",
          status: c.status,
          notes: c.notes ?? "",
        }}
      />
    </div>
  );
}
