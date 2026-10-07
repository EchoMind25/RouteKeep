import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireMember } from "@/lib/auth/session";
import { AGING_BUCKETS } from "@/lib/domain/billing";
import { formatCents } from "@/lib/domain/money";
import { todayIn } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { parseUsageFilters } from "@/lib/reports/product-usage";
import { agingSummary, productionByTechnician, revenueByMonth } from "@/lib/server/billing-reports";
import { pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Money reports" };

const BUCKET: Record<string, string> = { current: "Not due yet", "1-30": "1 to 30 days late", "31-60": "31 to 60", "61-90": "61 to 90", "90+": "Over 90" };
const monthLabel = (key: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`));

// FR-BIL-08: revenue, money owed and production by technician, from the ledger and visits.
export default async function MoneyReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  if (!isEnabled("reports") || !isEnabled("billing")) notFound();
  const member = await requireMember(["owner", "admin", "office"]);
  const { filters, problem } = parseUsageFilters(await searchParams, todayIn(member.timezone));
  const [revenue, aging, production] = await Promise.all([revenueByMonth(member, filters.from, filters.to), agingSummary(member), productionByTechnician(member, filters.from, filters.to)]);
  const owed = AGING_BUCKETS.reduce((sum, b) => sum + aging[b].cents, 0);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Money"
        description="Revenue and production for the dates you pick; money owed as of today."
        back={
          <Link href="/reports" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Reports
          </Link>
        }
      />
      <form action="/reports/billing" className="flex flex-wrap items-end gap-3" aria-label="Report dates">
        <Field label="From" className="w-44">
          <Input type="date" name="from" defaultValue={filters.from} required />
        </Field>
        <Field label="To" className="w-44">
          <Input type="date" name="to" defaultValue={filters.to} required />
        </Field>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {problem ? <Alert tone="warning">{problem}</Alert> : null}

      <section aria-labelledby="owed-title" className="grid gap-3">
        <h2 id="owed-title" className="text-md font-semibold">
          Money owed: {formatCents(owed)}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-5">
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="grid gap-0.5 rounded-panel border border-line bg-surface p-4">
              <dt className="text-sm text-fg-muted">{BUCKET[b]}</dt>
              <dd className="text-lg font-semibold tabular">{formatCents(aging[b].cents)}</dd>
              <dd className="text-sm text-fg-muted">{pluralize(aging[b].invoices, "invoice")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="revenue-title" className="grid gap-3">
        <h2 id="revenue-title" className="text-md font-semibold">
          Revenue by month
        </h2>
        {revenue.length === 0 ? (
          <EmptyState title="Nothing invoiced in these dates">Invoices and payments show up here by the month they happened.</EmptyState>
        ) : (
          <Table label="Revenue by month">
            <THead>
              <tr>
                <TH>Month</TH>
                <TH className="text-right">Invoiced</TH>
                <TH className="text-right">Collected</TH>
                <TH className="text-right">Credited</TH>
              </tr>
            </THead>
            <TBody>
              {revenue.map((r) => (
                <TR key={r.month}>
                  <TD>{monthLabel(r.month)}</TD>
                  <TD className="text-right tabular">{formatCents(r.invoicedCents)}</TD>
                  <TD className="text-right font-semibold tabular">{formatCents(r.collectedCents)}</TD>
                  <TD className="text-right tabular">{formatCents(r.creditedCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="production-title" className="grid gap-3">
        <h2 id="production-title" className="text-md font-semibold">
          Production by technician
        </h2>
        {production.length === 0 ? (
          <EmptyState title="No finished visits in these dates">Finished visits count here at their price, under the technician who did them.</EmptyState>
        ) : (
          <Table label="Production by technician">
            <THead>
              <tr>
                <TH>Technician</TH>
                <TH className="text-right">Finished visits</TH>
                <TH className="text-right">Value</TH>
              </tr>
            </THead>
            <TBody>
              {production.map((p) => (
                <TR key={p.technicianId ?? "none"}>
                  <TD>{p.technicianName}</TD>
                  <TD className="text-right tabular">{p.visits}</TD>
                  <TD className="text-right font-semibold tabular">{formatCents(p.valueCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
