import { ArrowLeft, DownloadSimple, FilePdf } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { amountText, areaText, parseUsageFilters, SCREEN_ROWS, totalText, usageQuery } from "@/lib/reports/product-usage";
import { productUsage, usageOptions } from "@/lib/server/reports";
import { formatInstant, pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Product usage" };

// FR-REC-06: product usage by date range, product, EPA number and technician.
export default async function ProductUsagePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; product?: string; technician?: string }> }) {
  if (!isEnabled("reports")) notFound();
  const member = await requireMember(OFFICE_ROLES);
  const { filters, problem } = parseUsageFilters(await searchParams, todayIn(member.timezone));
  const [report, options] = await Promise.all([productUsage(member, filters, SCREEN_ROWS), usageOptions(member)]);
  const tz = report.timeZone;
  const download = (format: "csv" | "pdf") => `/api/reports/product-usage?${usageQuery(filters, { format })}`;

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Product usage"
        description="From the application records as saved. An amended record counts once, as amended."
        back={
          <Link href="/reports" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Reports
          </Link>
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={download("csv")} download>
                <DownloadSimple size={18} aria-hidden /> CSV
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={download("pdf")} target="_blank" rel="noreferrer">
                <FilePdf size={18} aria-hidden /> PDF
              </a>
            </Button>
          </>
        }
      />

      <form action="/reports/products" className="grid gap-3 pb-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" aria-label="Report filters">
        <Field label="From" className="lg:w-44">
          <Input type="date" name="from" defaultValue={filters.from} required />
        </Field>
        <Field label="To" className="lg:w-44">
          <Input type="date" name="to" defaultValue={filters.to} required />
        </Field>
        <Field label="Product" className="lg:w-72">
          <Select name="product" defaultValue={filters.productId ?? ""}>
            <option value="">All products</option>
            {options.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.epa_reg_no ? `, EPA ${p.epa_reg_no}` : ""}
                {p.active ? "" : " (retired)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Technician" className="lg:w-56">
          <Select name="technician" defaultValue={filters.technicianId ?? ""}>
            <option value="">All technicians</option>
            {options.technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.display_name}
                {t.active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" className="sm:col-span-2 lg:col-span-1">
          Show
        </Button>
      </form>

      {problem ? <Alert tone="warning">{problem}</Alert> : null}

      {report.count === 0 ? (
        <EmptyState title="No products applied in this range">Records appear here as technicians complete stops. Try a longer range, or all products and technicians.</EmptyState>
      ) : (
        <>
          <section aria-labelledby="totals-heading" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="totals-heading" className="text-md font-semibold">
                Totals by product
              </h2>
              <p className="text-sm text-fg-muted">{pluralize(report.count, "application")}</p>
            </div>
            <Table label="Totals by product">
              <THead>
                <tr>
                  <TH>Product</TH>
                  <TH>EPA registration no.</TH>
                  <TH className="text-right">Applications</TH>
                  <TH>Total applied</TH>
                </tr>
              </THead>
              <TBody>
                {report.totals.map((t) => (
                  <TR key={`${t.productName}|${t.epaRegNo ?? ""}`}>
                    <TD>
                      <span className="font-medium">{t.productName}</span>
                      {t.restrictedUse ? (
                        <>
                          {" "}
                          <Badge tone="warning">Restricted use</Badge>
                        </>
                      ) : null}
                    </TD>
                    <TD className="tabular">{t.epaRegNo ?? <span className="text-fg-muted">None</span>}</TD>
                    <TD className="text-right tabular">{t.applications.toLocaleString("en-US")}</TD>
                    <TD className="tabular">{totalText(t)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>

          <section aria-labelledby="rows-heading" className="grid gap-3 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="rows-heading" className="text-md font-semibold">
                Each application
              </h2>
              {report.truncated ? (
                <p className="text-sm text-fg-muted">
                  The first {SCREEN_ROWS.toLocaleString("en-US")} of {report.count.toLocaleString("en-US")}. The CSV has every one.
                </p>
              ) : null}
            </div>
            <Table label="Each application">
              <THead>
                <tr>
                  <TH>Applied</TH>
                  <TH>Technician</TH>
                  <TH>Customer</TH>
                  <TH>Product</TH>
                  <TH>Total</TH>
                  <TH>Area</TH>
                  <TH>Target pests</TH>
                </tr>
              </THead>
              <TBody>
                {report.rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap tabular">{formatInstant(r.appliedAt, tz)}</TD>
                    <TD>{r.applicatorName}</TD>
                    <TD>
                      {r.appointmentId ? (
                        <Link href={`/schedule/visits/${r.appointmentId}`} className="font-medium hover:underline">
                          {r.customerName}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.customerName}</span>
                      )}
                      <span className="block text-sm text-fg-muted">{r.applicationAddress}</span>
                    </TD>
                    <TD>
                      {r.productName}
                      {r.amendment ? (
                        <>
                          {" "}
                          <Badge>Amended</Badge>
                        </>
                      ) : null}
                      {r.epaRegNo ? <span className="block text-sm text-fg-muted tabular">EPA {r.epaRegNo}</span> : null}
                    </TD>
                    <TD className="whitespace-nowrap tabular">{amountText(r.totalAmount, r.amountUnit)}</TD>
                    <TD className="whitespace-nowrap tabular">{areaText(r.areaTreated, r.areaUnit)}</TD>
                    <TD>{r.targetPests.join(", ")}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}
