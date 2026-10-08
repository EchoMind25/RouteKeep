import { ArrowLeft, FilePdf } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Details, PageHeader, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { getInvoice } from "@/lib/server/billing";
import { onlinePayments } from "@/lib/server/payments";
import { formatInstant, formatLocalDate } from "@/lib/ui/format";
import { INVOICE_STATUS } from "../../status";
import { CreditForm, PaymentForm, RefundForm, VoidForm } from "./forms";

export const metadata: Metadata = { title: "Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE: Record<string, string> = {
  paid: "Payment recorded.",
  credited: "Credit applied.",
  voided: "Invoice voided. It stays on file with the reason.",
  refunded: "Refunded. The money is on its way back to the customer.",
  "refund-pending": "Refund sent. Bank refunds take a few days; it shows in the history once the bank confirms.",
};
const ONLINE_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  succeeded: { label: "Paid", tone: "success" },
  processing: { label: "On its way", tone: "warning" },
  failed: { label: "Declined", tone: "danger" },
  canceled: { label: "Not completed", tone: "neutral" },
};
const ENTRY: Record<string, string> = { invoice: "Invoiced", payment: "Payment", credit: "Credit", refund: "Refund", opening_balance: "Opening balance" };
const METHOD: Record<string, string> = { cash: "cash", check: "check", other: "other", card: "card", ach: "bank", card_on_file: "card on file" };

// FR-BIL-01, FR-BIL-06: one invoice, what has been paid or credited, and what is left.
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const member = await requireMember(["owner", "admin", "office"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const invoice = await getInvoice(member, id);
  if (!invoice) notFound();
  const done = DONE[(await searchParams).done ?? ""];
  const online = await onlinePayments(member, invoice.id);
  const canRefund = member.role === "owner" || member.role === "admin";
  const status = INVOICE_STATUS[invoice.status] ?? INVOICE_STATUS.open!;
  const tz = invoice.timeZone;
  const open = invoice.status === "open";

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Invoice #${invoice.number}`}
        description={`${invoice.customer.name}, ${formatCents(invoice.totalCents)}`}
        back={
          <Link href="/billing" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Billing
          </Link>
        }
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/invoices/${invoice.id}`} target="_blank" rel="noreferrer">
              <FilePdf size={18} aria-hidden /> PDF
            </a>
          </Button>
        }
      />
      {done ? <Alert tone="success">{done}</Alert> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <Table label="Invoice lines">
            <THead>
              <tr>
                <TH>Service</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {invoice.lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    {l.appointmentId ? (
                      <Link href={`/schedule/visits/${l.appointmentId}`} className="hover:underline">
                        {l.description}
                      </Link>
                    ) : (
                      l.description
                    )}
                  </TD>
                  <TD className="text-right tabular">{formatCents(l.amountCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <Panel title="History" description="Every change is a new entry. Nothing is edited after the fact.">
            <ol className="divide-y divide-line">
              {invoice.ledger.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
                  <span>
                    <span className="font-medium">{ENTRY[e.type] ?? e.type}</span>
                    {e.method ? `, ${METHOD[e.method] ?? e.method}${e.checkNumber ? ` #${e.checkNumber}` : ""}` : ""}
                    {e.memo ? <span className="block text-sm text-fg-muted">{e.memo}</span> : null}
                  </span>
                  <span className="text-sm text-fg-muted tabular">{formatInstant(e.occurredAt, tz)}</span>
                  <span className="w-24 text-right font-medium tabular">{formatCents(e.amountCents)}</span>
                </li>
              ))}
            </ol>
          </Panel>

          {online.length ? (
            <Panel title="Card and bank payments" description="Paid online or by autopay, through your Stripe account.">
              <ul className="divide-y divide-line">
                {online.map((p) => {
                  const st = ONLINE_STATUS[p.status] ?? ONLINE_STATUS.canceled!;
                  return (
                    <li key={p.id} className="grid gap-3 px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span>
                          <span className="font-medium">{METHOD[p.method] ?? p.method}</span>
                          <span className="text-sm text-fg-muted">, {formatInstant(p.receivedAt ?? p.createdAt, tz)}</span>
                          {p.failure ? <span className="block text-sm text-fg-muted">{p.failure}</span> : null}
                          {p.refundedCents ? <span className="block text-sm text-fg-muted">{formatCents(p.refundedCents)} refunded</span> : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <span className="w-24 text-right font-medium tabular">{formatCents(p.amountCents)}</span>
                        </span>
                      </div>
                      {p.refundable && canRefund ? (
                        <details className="rounded-control border border-line px-4 py-3">
                          <summary className="cursor-pointer font-medium">Refund this payment</summary>
                          <div className="pt-4">
                            <RefundForm invoiceId={invoice.id} paymentId={p.id} refundKey={randomUUID()} maxAmount={((p.amountCents - p.refundedCents) / 100).toFixed(2)} />
                          </div>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          {open ? (
            <>
              <Panel title="Record a payment" description="Cash, check or another way it was paid. Card and bank payments made online show up on their own.">
                <div className="px-5 py-4">
                  <PaymentForm invoiceId={invoice.id} paymentKey={`pay-${randomUUID()}`} openAmount={(invoice.openCents / 100).toFixed(2)} />
                </div>
              </Panel>
              <Panel title="Credit" description="Take some or all of it off, with a reason. The invoice itself never changes.">
                <div className="px-5 py-4">
                  <CreditForm invoiceId={invoice.id} creditKey={randomUUID()} />
                </div>
              </Panel>
              {invoice.openCents === invoice.totalCents ? (
                <Panel title="Void" description="For an invoice made by mistake, before anything is paid on it.">
                  <div className="px-5 py-4">
                    <VoidForm invoiceId={invoice.id} />
                  </div>
                </Panel>
              ) : null}
            </>
          ) : null}
        </div>

        <Panel title="Summary">
          <div className="px-5 py-4">
            <Details
              items={[
                { label: "Status", value: <Badge tone={status.tone}>{status.label}</Badge> },
                { label: "Customer", value: <Link href={`/customers/${invoice.customer.id}`} className="hover:underline">{invoice.customer.name}</Link> },
                { label: "Issued", value: invoice.issuedAt ? formatInstant(invoice.issuedAt, tz) : "" },
                { label: "Due", value: invoice.dueDate ? formatLocalDate(invoice.dueDate) : "On receipt" },
                { label: "Total", value: <span className="tabular">{formatCents(invoice.totalCents)}</span> },
                { label: "Owed", value: <span className="font-semibold tabular">{formatCents(invoice.status === "void" ? 0 : invoice.openCents)}</span> },
                ...(invoice.paidAt ? [{ label: "Paid on", value: formatInstant(invoice.paidAt, tz) }] : []),
                ...(invoice.voidReason ? [{ label: "Voided because", value: invoice.voidReason }] : []),
              ]}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
