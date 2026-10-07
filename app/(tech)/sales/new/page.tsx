import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { withRls } from "@/lib/db/rls";
import { listPlans } from "@/lib/server/catalog";
import { getSalesSettings, myTechnician } from "@/lib/server/sales";
import { CustomerForm } from "../../../(office)/customers/new/customer-form";
import { createTechSaleAction } from "./actions";

export const metadata: Metadata = { title: "New customer" };

// FR-SAL-02: add a customer and sell a plan from the field.
export default async function TechNewCustomerPage() {
  const member = await requireMember(["technician"]);
  const [settings, me, plans, tenant] = await Promise.all([
    getSalesSettings(member),
    myTechnician(member),
    listPlans(member, { activeOnly: true }),
    withRls(member.claims, (tx) => tx.selectFrom("tenants").select("state").executeTakeFirstOrThrow()),
  ]);
  if (!settings.enabled || !me) {
    return (
      <>
        <PageHeader title="New customer" />
        <Alert tone="warning">
          {me ? "Your office has not turned on adding customers from the field." : "Your login is not linked to a technician profile yet. Ask the office."}
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New customer" description="Credited to you. The office schedules the visits and approves your commission." />
      <CustomerForm
        mode="technician"
        action={createTechSaleAction}
        commission={{ flatCents: settings.flatCents, pct: settings.pct }}
        plans={plans.map((p) => ({ id: p.id, name: p.name, rrule: p.rrule, priceCents: p.price_cents, initialPriceCents: p.initial_price_cents, serviceType: p.service_type_name }))}
        technicians={[]}
        today={todayIn(member.timezone)}
        defaultRegion={tenant.state}
        canSell
      />
    </>
  );
}
