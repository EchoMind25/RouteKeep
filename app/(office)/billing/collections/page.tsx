import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireMember } from "@/lib/auth/session";
import { formatPhone } from "@/lib/domain/contact";
import { formatCents } from "@/lib/domain/money";
import { collections } from "@/lib/server/billing";
import { formatLocalDate } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Collections" };

const BUCKET_LABEL: Record<string, string> = { "1-30": "1 to 30 days late", "31-60": "31 to 60 days late", "61-90": "61 to 90 days late", "90+": "Over 90 days late", current: "Not due yet" };

// FR-BIL-04: customers with overdue invoices, oldest first. Card retries join it with Stripe.
export default async function CollectionsPage() {
  const member = await requireMember(["owner", "admin", "office"]);
  const rows = await collections(member);
  const total = rows.reduce((sum, r) => sum + r.openCents, 0);
  return (
    <div className="grid gap-4">
      <PageHeader title="Collections" description={rows.length ? `${formatCents(total)} overdue across ${rows.length} ${rows.length === 1 ? "customer" : "customers"}.` : undefined} />
      {rows.length === 0 ? (
        <EmptyState title="Nobody is overdue">Customers show up here, oldest debt first, the day an invoice passes its due date.</EmptyState>
      ) : (
        <Table label="Overdue customers">
          <THead>
            <tr>
              <TH>Customer</TH>
              <TH>Contact</TH>
              <TH>Oldest due</TH>
              <TH className="text-right">Invoices</TH>
              <TH className="text-right">Overdue</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.customerId}>
                <TD>
                  <Link href={`/customers/${r.customerId}`} className="font-medium hover:underline">
                    {r.customerName}
                  </Link>
                </TD>
                <TD className="text-sm">
                  {r.phone ? <a href={`tel:${r.phone}`} className="block hover:underline">{formatPhone(r.phone)}</a> : null}
                  {r.email ? <a href={`mailto:${r.email}`} className="block text-fg-muted hover:underline">{r.email}</a> : null}
                </TD>
                <TD className="whitespace-nowrap">
                  {formatLocalDate(r.oldestDue)} <Badge tone={r.bucket === "1-30" ? "warning" : "danger"}>{BUCKET_LABEL[r.bucket]}</Badge>
                </TD>
                <TD className="text-right tabular">{r.invoices}</TD>
                <TD className="text-right font-semibold tabular">{formatCents(r.openCents)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
