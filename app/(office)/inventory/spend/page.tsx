import { DownloadSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { costPerVisit, spend } from "@/lib/server/inventory";
import { pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Material spend" };

const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const monthLabel = (m: string) => monthName.format(new Date(`${m}-01T00:00:00Z`));

// FR-INV-09: what you spent on product (received orders) and what a visit costs in product.
export default async function SpendPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const [months, costs] = await Promise.all([spend(member, 6), costPerVisit(member)]);
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[65ch] text-fg-muted">Spend counts orders when you mark them received, at the price on the order. Cost per visit uses the average price you paid over the last 12 months.</p>
        <Button asChild variant="secondary">
          <a href="/api/inventory/spend" download>
            <DownloadSimple size={18} aria-hidden /> CSV
          </a>
        </Button>
      </div>

      <section aria-labelledby="spend-heading" className="grid gap-3">
        <h2 id="spend-heading" className="text-md font-semibold">
          By month and vendor, last 6 months
        </h2>
        {months.length === 0 ? (
          <EmptyState title="No received orders yet">When you mark an order received, its cost appears here.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {months.map((m) => (
              <Panel key={m.month} title={monthLabel(m.month)} actions={<span className="font-semibold tabular">{formatCents(m.totalCents)}</span>}>
                <ul className="divide-y divide-line">
                  {m.vendors.map((v) => (
                    <li key={v.vendorId} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span>{v.name}</span>
                      <span className="tabular">{formatCents(v.cents)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="cost-heading" className="grid gap-3">
        <h2 id="cost-heading" className="text-md font-semibold">
          Product cost per visit
        </h2>
        {costs.length === 0 ? (
          <EmptyState title="Not enough visits yet">A service type needs at least 10 completed visits with products recorded before its cost per visit shows.</EmptyState>
        ) : (
          <Table label="Product cost per visit by service type">
            <THead>
              <tr>
                <TH>Service type</TH>
                <TH className="text-right">Visits it is based on</TH>
                <TH className="text-right">Cost per visit</TH>
                <TH>Note</TH>
              </tr>
            </THead>
            <TBody>
              {costs.map((c) => (
                <TR key={c.serviceTypeId}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="text-right tabular">{pluralize(c.visits, "visit")}</TD>
                  <TD className="text-right tabular">{formatCents(c.centsPerVisit)}</TD>
                  <TD className="text-sm text-fg-muted">
                    {c.unpricedProducts.length > 0 ? (
                      <>
                        <Badge tone="warning">Floor</Badge> No price yet for {c.unpricedProducts.join(", ")}
                      </>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
