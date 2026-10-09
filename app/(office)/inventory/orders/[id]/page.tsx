import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/office/action-form";
import { PrintButton } from "@/components/office/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { orderMailto } from "@/lib/inventory/order-email";
import { ORDER_STATUS } from "@/lib/inventory/ui";
import { getInventorySettings, getPurchaseOrder, listLocations, listVendorProducts } from "@/lib/server/inventory";
import { formatLocalDate, formatInstant } from "@/lib/ui/format";
import { cancelOrderAction, markSentAction, receiveOrderAction, saveDraftAction } from "../../actions";

export const metadata: Metadata = { title: "Order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FR-INV-05, FR-INV-06: one purchase order. Draft is editable; the owner sends it from their own mail app, then marks it sent and received.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const member = await requireMember(INVENTORY_ROLES);
  const order = await getPurchaseOrder(member, id);
  if (!order) notFound();
  const manage = canManage(member.role);
  const settings = await getInventorySettings(member);
  const status = ORDER_STATUS[order.status] ?? { label: order.status, tone: "neutral" as const };
  const draft = order.status === "draft";
  const sent = order.status === "sent";
  const lineText = order.lines.map((l) => ({ productName: l.product_name, sku: l.sku, packages: l.packages, packageLabel: l.package_label }));
  const mailto = orderMailto({
    businessName: member.tenantName,
    vendorName: order.vendor_name,
    vendorEmail: order.vendor_email,
    accountNo: order.vendor_account_no,
    orderNumber: order.number,
    notes: order.notes,
    lines: lineText,
  });
  const [locations, addable] = await Promise.all([
    sent && settings.mode === "tracked" ? listLocations(member) : Promise.resolve([]),
    draft ? listVendorProducts(member, { vendorId: order.vendor_id }) : Promise.resolve([]),
  ]);
  const onOrder = new Set(order.lines.map((l) => l.vendor_product_id));
  const editable = order.lines.filter((l) => l.vendor_product_id);

  return (
    <div className="grid gap-6">
      <div className="print:hidden">
        <Link href="/inventory/orders" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft size={14} aria-hidden /> Orders
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Order {order.number ?? ""} <span className="font-normal text-fg-muted">to {order.vendor_name}</span>
          </h2>
          <p className="text-fg-muted">
            From {member.tenantName}
            {order.vendor_account_no ? `. Account number ${order.vendor_account_no}` : ""}
            {order.order_date ? `. Sent ${formatLocalDate(order.order_date, "full")}` : ""}
            {order.expected_date && sent ? `. Expected ${formatLocalDate(order.expected_date, "full")}` : ""}
            {order.received_at ? `. Received ${formatInstant(order.received_at, settings.timezone)}` : ""}
          </p>
        </div>
        <Badge tone={status.tone} className="print:hidden">
          {status.label}
        </Badge>
      </header>

      {draft || sent ? (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button asChild>
            <a href={mailto}>
              <EnvelopeSimple size={18} aria-hidden /> Email this order
            </a>
          </Button>
          <PrintButton />
          <p className="basis-full text-sm text-fg-muted">
            This opens a message in your own mail app with the lines filled in. RouteVerde does not send it or contact the vendor.
            {order.vendor_email ? "" : " Add the vendor's email under Vendors to fill in the address."}
          </p>
        </div>
      ) : null}

      {draft && manage ? (
        <ActionForm action={saveDraftAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="lineIds" value={editable.map((l) => l.vendor_product_id).join(",")} />
          <Table label="Order lines">
            <THead>
              <tr>
                <TH>Product</TH>
                <TH>Package</TH>
                <TH className="text-right">Packages</TH>
                <TH className="text-right">Price each</TH>
                <TH>Remove</TH>
              </tr>
            </THead>
            <TBody>
              {editable.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">{l.product_name}</TD>
                  <TD>{l.package_label}</TD>
                  <TD className="text-right">
                    <label>
                      <span className="sr-only">Packages of {l.product_name}</span>
                      <Input name={`packages:${l.vendor_product_id}`} type="number" min={1} step={1} inputMode="numeric" defaultValue={l.packages} className="ml-auto w-20" />
                    </label>
                  </TD>
                  <TD className="text-right tabular">{l.price_cents === null ? "None" : formatCents(l.price_cents)}</TD>
                  <TD>
                    <Checkbox name={`remove:${l.vendor_product_id}`} label={<span className="sr-only">Remove {l.product_name}</span>} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {addable.some((p) => p.active && !onOrder.has(p.id)) ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label="Add a product" optional>
                <Select name="addPackage" defaultValue="">
                  <option value="">Choose</option>
                  {addable
                    .filter((p) => p.active && !onOrder.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.product_name}, {p.package_label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="How many" optional>
                <Input name="addPackages" type="number" min={1} step={1} inputMode="numeric" defaultValue={1} />
              </Field>
            </div>
          ) : null}
          <Field label="Note to the vendor" optional hint="Included in the email and the printout.">
            <Textarea name="notes" rows={2} defaultValue={order.notes ?? ""} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold tabular">{formatCents(order.totalCents)} estimated</p>
            <SubmitButton variant="secondary" pendingLabel="Saving">
              Save changes
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <>
          <Table label="Order lines">
            <THead>
              <tr>
                <TH>Product</TH>
                <TH>Package</TH>
                <TH className="text-right">Packages</TH>
                {order.status === "received" ? <TH className="text-right">Received</TH> : null}
                <TH className="text-right">Price each</TH>
                <TH className="text-right">Line total</TH>
              </tr>
            </THead>
            <TBody>
              {order.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">
                    {l.product_name}
                    {l.sku ? <span className="block text-sm font-normal text-fg-muted">Item {l.sku}</span> : null}
                  </TD>
                  <TD>{l.package_label}</TD>
                  <TD className="text-right tabular">{l.packages}</TD>
                  {order.status === "received" ? <TD className="text-right tabular">{l.received_packages ?? l.packages}</TD> : null}
                  <TD className="text-right tabular">{l.price_cents === null ? "None" : formatCents(l.price_cents)}</TD>
                  <TD className="text-right tabular">{l.price_cents === null ? "" : formatCents(l.packages * l.price_cents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-right font-semibold tabular">{formatCents(order.totalCents)} estimated</p>
          {order.notes ? <p className="text-fg-muted">{order.notes}</p> : null}
        </>
      )}

      {manage && draft ? (
        <Panel title="Sent it?" description="Save any changes first. Marking it sent lets the forecast count it as on its way." className="print:hidden">
          <ActionForm action={markSentAction} className="px-5 py-4">
            <input type="hidden" name="orderId" value={order.id} />
            <div>
              <SubmitButton pendingLabel="Saving">Mark as sent</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      ) : null}

      {manage && sent ? (
        <Panel title="It arrived" description="Count what came. Short or extra packages are fine, enter what you actually got." className="print:hidden">
          <ActionForm action={receiveOrderAction} className="px-5 py-4">
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="lineIds" value={order.lines.map((l) => l.id).join(",")} />
            {settings.mode === "tracked" ? (
              <Field label="Delivered to">
                <Select name="locationId" defaultValue={order.received_location_id ?? locations.find((l) => l.kind === "shop")?.id ?? ""} className="max-w-72">
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <ul className="grid gap-3">
              {order.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{l.product_name}</span> <span className="text-fg-muted">ordered {l.packages} x {l.package_label}</span>
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    <span>Received</span>
                    <Input name={`received:${l.id}`} type="number" min={0} step={1} inputMode="numeric" defaultValue={l.packages} className="w-20" />
                  </label>
                </li>
              ))}
            </ul>
            <div>
              <SubmitButton pendingLabel="Saving">Mark as received</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      ) : null}

      {manage && (draft || sent) ? (
        <ActionForm action={cancelOrderAction} className="print:hidden">
          <input type="hidden" name="orderId" value={order.id} />
          <div>
            <ConfirmSubmitButton variant="ghost" confirmLabel="Press again to cancel this order" pendingLabel="Cancelling">
              Cancel this order
            </ConfirmSubmitButton>
          </div>
        </ActionForm>
      ) : null}
      {order.status === "received" ? <Alert className="print:hidden">Received orders are kept as a record. Fix a quantity with an adjustment on the Stock page.</Alert> : null}
    </div>
  );
}
