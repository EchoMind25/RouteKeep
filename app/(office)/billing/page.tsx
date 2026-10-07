import { Receipt } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { lastBillingRun, listInvoices, type InvoiceFilter } from "@/lib/server/billing";
import { formatInstant, formatLocalDate, pluralize } from "@/lib/ui/format";
import { runBillingAction } from "./actions";
import { INVOICE_STATUS } from "./status";

export const metadata: Metadata = { title: "Billing" };

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
];

// S11 (FR-BIL-01, FR-BIL-04): invoices, and the button that bills finished visits.
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ show?: string; ran?: string }> }) {
  const member = await requireMember(["owner", "admin", "office"]);
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.key === params.show)?.key ?? "open") as InvoiceFilter;
  const [invoices, run] = await Promise.all([listInvoices(member, filter), lastBillingRun(member)]);
  const ran = params.ran?.split(".").map(Number);
  const openTotal = invoices.reduce((sum, i) => sum + (i.status === "open" ? i.openCents : 0), 0);

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Billing"
        description={run ? `Last billed ${formatInstant(run.started_at, member.timezone)}.` : "Nothing billed yet."}
        actions={
          <form action={runBillingAction}>
            <SubmitButton pendingLabel="Billing">
              <Receipt size={18} aria-hidden /> Invoice finished visits
            </SubmitButton>
          </form>
        }
      />
      {ran ? (
        <Alert tone={ran[2] ? "warning" : "success"}>
          {pluralize(ran[0] ?? 0, "invoice")} made, {pluralize(ran[1] ?? 0, "payment")} posted
          {ran[2] ? `, ${pluralize(ran[2], "item")} failed and will be retried next time` : ""}.
        </Alert>
      ) : null}
      <nav aria-label="Invoice filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/billing?show=${f.key}`}
            aria-current={f.key === filter ? "page" : undefined}
            className={`rounded-pill border px-3 py-1.5 text-sm font-medium ${f.key === filter ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:text-fg"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {invoices.length === 0 ? (
        <EmptyState title={filter === "open" ? "Nothing open" : "No invoices here"}>
          Finished visits with a price are invoiced when you press Invoice finished visits, and every night once the scheduler runs.
        </EmptyState>
      ) : (
        <>
          {filter === "open" || filter === "overdue" ? <p className="text-md text-fg-muted">Still owed: <span className="font-semibold text-fg tabular">{formatCents(openTotal)}</span></p> : null}
          <Table label="Invoices">
            <THead>
              <tr>
                <TH>Number</TH>
                <TH>Customer</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Owed</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {invoices.map((i) => {
                const status = INVOICE_STATUS[i.status] ?? INVOICE_STATUS.open!;
                return (
                  <TR key={i.id}>
                    <TD className="tabular">
                      <Link href={`/billing/invoices/${i.id}`} className="font-medium hover:underline">
                        #{i.number}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/customers/${i.customerId}`} className="hover:underline">
                        {i.customerName}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap tabular">{i.issuedAt ? formatInstant(i.issuedAt, member.timezone) : ""}</TD>
                    <TD className="whitespace-nowrap tabular">{i.dueDate ? formatLocalDate(i.dueDate) : ""}</TD>
                    <TD className="text-right tabular">{formatCents(i.totalCents)}</TD>
                    <TD className="text-right font-semibold tabular">{i.status === "open" ? formatCents(i.openCents) : ""}</TD>
                    <TD>
                      <Badge tone={i.overdue ? "danger" : status.tone}>{i.overdue ? "Overdue" : status.label}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
