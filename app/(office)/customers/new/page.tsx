import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { withRls } from "@/lib/db/rls";
import { listPlans, listTechnicians } from "@/lib/server/catalog";
import { CustomerForm } from "./customer-form";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const member = await requireMember(OFFICE_ROLES);
  const [plans, technicians, tenant] = await Promise.all([
    listPlans(member, { activeOnly: true }),
    listTechnicians(member, { activeOnly: true }),
    withRls(member.claims, (tx) => tx.selectFrom("tenants").select(["state", "tech_sales_enabled"]).executeTakeFirstOrThrow()),
  ]);

  return (
    <div className="grid gap-2">
      <PageHeader
        title="New customer"
        description="Customer, address and plan in one pass."
        back={
          <Link href="/customers" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Customers
          </Link>
        }
      />
      <CustomerForm
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          rrule: p.rrule,
          priceCents: p.price_cents,
          initialPriceCents: p.initial_price_cents,
          serviceType: p.service_type_name,
        }))}
        technicians={technicians.map((t) => ({ id: t.id, name: t.display_name }))}
        today={todayIn(member.timezone)}
        defaultRegion={tenant.state}
        canSell={member.role !== "dispatcher"}
        sellers={tenant.tech_sales_enabled ? technicians.map((t) => ({ id: t.id, name: t.display_name })) : undefined}
      />
    </div>
  );
}
