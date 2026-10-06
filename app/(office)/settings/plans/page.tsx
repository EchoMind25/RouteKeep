import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { describeRule } from "@/lib/domain/recurrence";
import { listPlans, listServiceTypes } from "@/lib/server/catalog";
import { BILLING_MODE } from "@/lib/ui/format";
import { setPlanActive } from "../actions";
import { PlanForm } from "../forms";

export const metadata: Metadata = { title: "Service plans" };

export default async function PlansPage() {
  const member = await requireMember(OFFICE_ROLES);
  const [plans, types] = await Promise.all([listPlans(member), listServiceTypes(member)]);
  const manage = canManage(member.role);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_30rem]">
      {plans.length === 0 ? (
        <EmptyState title="No plans yet">
          A plan is what you sell: a service, a price and how often you come back. Existing customers keep the price and schedule they bought even if you change a plan later.
        </EmptyState>
      ) : (
        <Table label="Service plans">
          <THead>
            <tr>
              <TH>Plan</TH>
              <TH className="text-right">Per visit</TH>
              <TH className="hidden md:table-cell">Billing</TH>
              {manage ? <TH className="sr-only">Actions</TH> : null}
            </tr>
          </THead>
          <TBody>
            {plans.map((p) => (
              <TR key={p.id}>
                <TD>
                  <p className="font-medium">
                    {p.name} {!p.active ? <Badge className="ml-1">Retired</Badge> : null}
                  </p>
                  <p className="text-sm text-fg-muted">
                    {p.service_type_name}. {describeRule(p.rrule)}
                  </p>
                </TD>
                <TD className="text-right whitespace-nowrap tabular">
                  {formatCents(p.price_cents)}
                  {p.initial_price_cents !== null ? <p className="text-sm text-fg-muted">first {formatCents(p.initial_price_cents)}</p> : null}
                </TD>
                <TD className="hidden text-fg-muted md:table-cell">{BILLING_MODE[p.billing_mode]}</TD>
                {manage ? (
                  <TD className="text-right">
                    <form action={setPlanActive}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="active" value={String(!p.active)} />
                      <Button variant="ghost" size="sm" type="submit">
                        {p.active ? "Retire" : "Restore"}
                      </Button>
                    </form>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {manage ? (
        <Panel title="Create a plan">
          <div className="px-5 py-4">
            <PlanForm serviceTypes={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, category: t.category }))} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
