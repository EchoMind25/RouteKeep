import type { Metadata } from "next";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { commissionBasis } from "@/lib/domain/commission";
import { listPlans } from "@/lib/server/catalog";
import { getSalesSettings } from "@/lib/server/sales";
import { SalesSettingsForm } from "./form";

export const metadata: Metadata = { title: "Sales settings" };

// FR-SAL-01.
export default async function SalesSettingsPage() {
  const member = await requireMember(OFFICE_ROLES);
  const [settings, plans] = await Promise.all([getSalesSettings(member), listPlans(member, { activeOnly: true })]);
  const plan = plans[0];
  return (
    <SalesSettingsForm
      readOnly={!canManage(member.role)}
      examplePlan={plan ? { name: plan.name, basisCents: commissionBasis({ priceCents: plan.price_cents, initialPriceCents: plan.initial_price_cents }) } : null}
      initial={{
        enabled: settings.enabled ? "on" : "",
        flat: settings.flatCents ? (settings.flatCents / 100).toFixed(2) : "",
        pct: settings.pct ? String(settings.pct) : "",
      }}
    />
  );
}
