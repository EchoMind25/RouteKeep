import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { amountLabel } from "@/lib/domain/units";
import { BUCKET_LABEL, qtyText, rangeText } from "@/lib/inventory/ui";
import { resupplySuggestions, stockOnHand, usageAndForecast } from "@/lib/server/inventory";
import { formatLocalDate, pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Inventory" };

// FR-INV-02, FR-INV-03, FR-INV-05, FR-INV-11: what the schedule will use, what to check, and what is running low.
export default async function InventoryOverviewPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const [data, resupply] = await Promise.all([usageAndForecast(member), resupplySuggestions(member)]);
  const tracked = resupply.mode === "tracked";
  const stock = tracked ? await stockOnHand(member) : [];
  const held = new Map<string, number>();
  for (const r of stock) held.set(r.productId, (held.get(r.productId) ?? 0) + r.qty);

  const checks = data.products.filter((p) => p.checkUnits > 0);
  const low = resupply.vendors.flatMap((v) => v.lines.filter((l) => l.orderBy !== null).map((l) => ({ ...l, vendorName: v.vendorName }))).sort((a, b) => a.orderBy!.localeCompare(b.orderBy!));

  return (
    <div className="grid gap-8">
      {data.products.length === 0 ? (
        <EmptyState title="Nothing to forecast yet">
          The forecast needs completed visits with products recorded on them. Once technicians have finished some stops, this page shows what the schedule will use.
        </EmptyState>
      ) : (
        <section aria-labelledby="forecast-heading" className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="forecast-heading" className="text-md font-semibold">
              What the schedule will use
            </h2>
            <p className="text-sm text-fg-muted">
              Scheduled visits times what the same kind of visit used over the last 8 weeks (26 weeks when there are fewer than 10). Amounts are product, not finished mix.
            </p>
          </div>
          <Table label="Forecast by product">
            <THead>
              <tr>
                <TH>Product</TH>
                {data.buckets.map((b) => (
                  <TH key={b.key} className="text-right">
                    {BUCKET_LABEL[b.key]}
                    <span className="sr-only">, {rangeText(b.from, b.to)}</span>
                  </TH>
                ))}
                {tracked ? <TH className="text-right">On hand</TH> : null}
                <TH className="text-right">Last week</TH>
                <TH className="text-right">Weekly average, 4 / 8 / 12 weeks</TH>
                <TH>Based on</TH>
              </tr>
            </THead>
            <TBody>
              {data.products.map((p) => (
                <TR key={p.productId}>
                  <TD className="font-medium">
                    {p.name}
                    {p.checkUnits > 0 ? (
                      <>
                        {" "}
                        <Badge tone="warning">Check units</Badge>
                      </>
                    ) : null}
                  </TD>
                  {p.forecast.map((q, i) => (
                    <TD key={data.buckets[i]!.key} className="text-right whitespace-nowrap tabular">
                      {q > 0 ? qtyText(q, p.unit) : <span className="text-fg-muted">None</span>}
                    </TD>
                  ))}
                  {tracked ? <TD className="text-right whitespace-nowrap tabular">{qtyText(held.get(p.productId) ?? 0, p.unit)}</TD> : null}
                  <TD className="text-right whitespace-nowrap tabular">{qtyText(p.weekly.lastWeek, p.unit)}</TD>
                  <TD className="text-right whitespace-nowrap text-sm tabular">
                    {qtyText(p.weekly.avg4, p.unit)} / {qtyText(p.weekly.avg8, p.unit)} / {qtyText(p.weekly.avg12, p.unit)}
                  </TD>
                  <TD className="text-sm text-fg-muted">{p.windowWeeks ? `${pluralize(p.basisVisits, "visit")}, last ${p.windowWeeks} weeks` : "Not enough visits yet"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-sm text-fg-muted">&quot;Rest of month&quot; counts from today and overlaps the weeks. Today is {formatLocalDate(data.today, "long")}.</p>
        </section>
      )}

      {data.unforecastVisits > 0 || data.unscheduledVisits > 0 || data.unlinkedApplications > 0 ? (
        <Alert tone="neutral" title="Not in the forecast">
          <ul className="grid list-disc gap-1 pl-5">
            {data.unforecastVisits > 0 ? <li>{pluralize(data.unforecastVisits, "scheduled visit")} of a service type with fewer than 10 completed visits to learn from.</li> : null}
            {data.unscheduledVisits > 0 ? <li>{pluralize(data.unscheduledVisits, "visit")} with no date. They are never spread across the weeks.</li> : null}
            {data.unlinkedApplications > 0 ? <li>{pluralize(data.unlinkedApplications, "application")} with no product picked from your list, so there is no stock to take them from.</li> : null}
          </ul>
        </Alert>
      ) : null}

      {checks.length > 0 ? (
        <Panel title="Check units" description="These applications were left out, not counted as zero. Usually the product's stock unit and the unit a technician recorded do not match, such as gallons against pounds.">
          <ul className="divide-y divide-line">
            {checks.map((p) => (
              <li key={p.productId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span>
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-fg-muted">
                    {pluralize(p.checkUnits, "application")} left out{p.unit ? `, stock unit ${amountLabel(p.unit)}` : ", no stock unit"}
                  </span>
                </span>
                <Link href="/settings/products" className="text-sm font-medium text-accent hover:underline">
                  Set the stock unit
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tracked ? (
        <Panel title="Running low" description="Products whose stock, counting what is on order, is projected to fall below its safety level. Order by is the date to order so it arrives in time.">
          {low.length === 0 ? (
            <p className="px-5 py-4 text-fg-muted">Nothing is projected to run low. Stock covers the forecast.</p>
          ) : (
            <Table label="Running low" className="border-0">
              <THead>
                <tr>
                  <TH>Product</TH>
                  <TH>Order by</TH>
                  <TH>Vendor</TH>
                  <TH className="text-right">Suggested</TH>
                </tr>
              </THead>
              <TBody>
                {low.map((l) => (
                  <TR key={l.vendorProductId}>
                    <TD className="font-medium">{l.productName}</TD>
                    <TD className="whitespace-nowrap">
                      {formatLocalDate(l.orderBy)} {l.late ? <Badge tone="danger">Order today</Badge> : null}
                    </TD>
                    <TD>{l.vendorName}</TD>
                    <TD className="text-right whitespace-nowrap tabular">
                      {l.packages} x {l.packageLabel}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <div className="border-t border-line px-5 py-3">
            <Link href="/inventory/resupply" className="text-sm font-medium text-accent hover:underline">
              See the full resupply list
            </Link>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Usage that stands out"
        description="A technician using more than 1.5 times or less than half of the business median per visit, for the same service and product. At least 10 visits each. A prompt to talk, not a verdict."
      >
        {data.outliers.length === 0 ? (
          <p className="px-5 py-4 text-fg-muted">No one stands out.</p>
        ) : (
          <Table label="Usage that stands out" className="border-0">
            <THead>
              <tr>
                <TH>Technician</TH>
                <TH>Service</TH>
                <TH>Product</TH>
                <TH className="text-right">Per visit</TH>
                <TH className="text-right">Business median</TH>
                <TH>Compared</TH>
              </tr>
            </THead>
            <TBody>
              {data.outliers.map((o) => {
                const unit = data.products.find((p) => p.productId === o.productId)?.unit ?? null;
                return (
                  <TR key={`${o.technicianId}|${o.serviceTypeId}|${o.productId}`}>
                    <TD className="font-medium">{o.technicianName}</TD>
                    <TD>{o.serviceTypeName}</TD>
                    <TD>{o.productName}</TD>
                    <TD className="text-right whitespace-nowrap tabular">{qtyText(o.perVisit, unit)}</TD>
                    <TD className="text-right whitespace-nowrap tabular">{qtyText(o.median, unit)}</TD>
                    <TD>
                      <Badge tone={o.direction === "high" ? "warning" : "neutral"}>{o.direction === "high" ? "Higher" : "Lower"}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
