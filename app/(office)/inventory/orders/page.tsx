import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { ORDER_STATUS } from "@/lib/inventory/ui";
import { listPurchaseOrders } from "@/lib/server/inventory";
import { formatLocalDate, pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Orders" };

// FR-INV-05: purchase orders, newest first.
export default async function OrdersPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const orders = await listPurchaseOrders(member);
  if (orders.length === 0) {
    return (
      <EmptyState title="No orders yet">
        Make one from the{" "}
        <Link href="/inventory/resupply" className="font-medium text-accent hover:underline">
          resupply list
        </Link>
        . It starts as a draft you can print or email yourself to the vendor.
      </EmptyState>
    );
  }
  return (
    <Table label="Purchase orders">
      <THead>
        <tr>
          <TH>Order</TH>
          <TH>Vendor</TH>
          <TH>Status</TH>
          <TH className="hidden sm:table-cell">Expected</TH>
          <TH className="text-right">Lines</TH>
          <TH className="text-right">Total</TH>
        </tr>
      </THead>
      <TBody>
        {orders.map((o) => {
          const s = ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
          return (
            <TR key={o.id}>
              <TD>
                <Link href={`/inventory/orders/${o.id}`} className="font-medium hover:underline">
                  Order {o.number ?? ""}
                </Link>
                <span className="block text-sm text-fg-muted">{o.order_date ? formatLocalDate(o.order_date, "short") : "Not sent"}</span>
              </TD>
              <TD>{o.vendor_name}</TD>
              <TD>
                <Badge tone={s.tone}>{s.label}</Badge>
              </TD>
              <TD className="hidden whitespace-nowrap sm:table-cell">{o.expected_date && o.status === "sent" ? formatLocalDate(o.expected_date, "short") : ""}</TD>
              <TD className="text-right tabular">{pluralize(o.line_count, "line")}</TD>
              <TD className="text-right tabular">{formatCents(o.total_cents)}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
