import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/office/action-form";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert, EmptyState, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { addDays } from "@/lib/domain/time";
import { isAmountUnit } from "@/lib/domain/units";
import { qtyText, rangeText } from "@/lib/inventory/ui";
import { listProducts } from "@/lib/server/catalog";
import { countVariances, getInventorySettings, listLocations, restockList, stockOnHand } from "@/lib/server/inventory";
import { formatLocalDate, pluralize } from "@/lib/ui/format";
import { adjustStockAction, restockTruckAction, transferStockAction } from "../actions";

export const metadata: Metadata = { title: "Stock" };

// FR-INV-06, FR-INV-07, FR-INV-08: stock in the shop and on each truck, restock lists, and truck check variances. Tracked mode only.
export default async function StockPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const settings = await getInventorySettings(member);
  if (settings.mode !== "tracked") notFound();
  const manage = canManage(member.role);
  const [locations, stock, products, restock, variances] = await Promise.all([
    listLocations(member),
    stockOnHand(member),
    listProducts(member),
    restockList(member),
    countVariances(member, 30),
  ]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const cell = new Map(stock.map((r) => [`${r.locationId}|${r.productId}`, r]));
  const rowIds = [...new Set(stock.map((r) => r.productId))].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const shop = locations.find((l) => l.kind === "shop");
  const trucks = locations.filter((l) => l.kind === "truck");
  const activeProducts = products.filter((p) => p.active);

  return (
    <div className="grid gap-8">
      <section aria-labelledby="onhand-heading" className="grid gap-3">
        <h2 id="onhand-heading" className="text-md font-semibold">
          On hand
        </h2>
        {rowIds.length === 0 ? (
          <EmptyState title="No stock recorded yet">
            Receive an order into the shop, or ask technicians to count their trucks on resupply day. You can also add stock below with an adjustment.
          </EmptyState>
        ) : (
          <Table label="Stock on hand by location">
            <THead>
              <tr>
                <TH>Product</TH>
                {locations.map((l) => (
                  <TH key={l.id} className="text-right">
                    {l.name}
                  </TH>
                ))}
              </tr>
            </THead>
            <TBody>
              {rowIds.map((id) => (
                <TR key={id}>
                  <TD className="font-medium">{names.get(id) ?? "Product"}</TD>
                  {locations.map((l) => {
                    const r = cell.get(`${l.id}|${id}`);
                    return (
                      <TD key={l.id} className="text-right whitespace-nowrap tabular">
                        {r ? (
                          <>
                            <span className={r.qty < 0 ? "text-danger" : undefined}>{qtyText(r.qty, r.unit)}</span>
                            {r.skipped > 0 ? (
                              <span className="block">
                                <Badge tone="warning">Check units</Badge>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-fg-muted">None</span>
                        )}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="text-sm text-fg-muted">
          On hand is the last count plus what was received or moved since, minus what the technician used on visits. A negative number means more was used than was counted or received.
        </p>
      </section>

      <section aria-labelledby="restock-heading" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="restock-heading" className="text-md font-semibold">
            Truck restock
          </h2>
          <p className="text-sm text-fg-muted">What each truck needs for its technician&apos;s scheduled visits until the next resupply day, minus what is on it.</p>
        </div>
        {restock.length === 0 ? <Alert>No trucks yet. Add technicians and turn tracking on again to create their trucks.</Alert> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {restock.map((t) => {
            const short = t.items.filter((i) => i.shortfall > 0);
            return (
              <Panel key={t.locationId} title={t.name} description={`Visits ${rangeText(t.from, addDays(t.until, -1))}, up to the next resupply day`}>
                {t.items.length === 0 ? (
                  <p className="px-5 py-4 text-fg-muted">No forecast need before the next resupply day.</p>
                ) : (
                  <Table label={`Restock list for ${t.name}`} className="border-0">
                    <THead>
                      <tr>
                        <TH>Product</TH>
                        <TH className="text-right">Needs</TH>
                        <TH className="text-right">On truck</TH>
                        <TH className="text-right">Short</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {t.items.map((i) => (
                        <TR key={i.productId}>
                          <TD className="font-medium">{i.name}</TD>
                          <TD className="text-right whitespace-nowrap tabular">{qtyText(i.need, i.unit)}</TD>
                          <TD className="text-right whitespace-nowrap tabular">{qtyText(i.onHand, i.unit)}</TD>
                          <TD className="text-right whitespace-nowrap tabular">{i.shortfall > 0 ? <span className="font-semibold">{qtyText(i.shortfall, i.unit)}</span> : <span className="text-fg-muted">None</span>}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
                {manage && short.length > 0 ? (
                  <ActionForm action={restockTruckAction} className="border-t border-line px-5 py-4">
                    <input type="hidden" name="locationId" value={t.locationId} />
                    <div className="flex flex-wrap items-center gap-3">
                      <SubmitButton variant="secondary" pendingLabel="Moving">
                        Transfer these from the shop
                      </SubmitButton>
                      <span className="text-sm text-fg-muted">{pluralize(short.length, "product")} moves from {shop?.name ?? "the shop"}.</span>
                    </div>
                  </ActionForm>
                ) : null}
              </Panel>
            );
          })}
        </div>
      </section>

      {manage ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Panel title="Move product to a truck" description="Takes it out of one place and puts it in another.">
            <ActionForm action={transferStockAction} className="px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From">
                  <Select name="fromLocationId" defaultValue={shop?.id ?? ""}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="To">
                  <Select name="toLocationId" defaultValue={trucks[0]?.id ?? ""}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Product">
                  <Select name="productId" defaultValue="">
                    <option value="">Choose a product</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount" hint="In the product's stock unit.">
                  <Input name="qty" inputMode="decimal" />
                </Field>
              </div>
              <div>
                <SubmitButton pendingLabel="Moving">Move</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
          <Panel title="Adjust stock" description="For spills, returns, a recount or anything else. Say why.">
            <ActionForm action={adjustStockAction} className="px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Where">
                  <Select name="locationId" defaultValue={shop?.id ?? ""}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Product">
                  <Select name="productId" defaultValue="">
                    <option value="">Choose a product</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Change" hint="Use a minus sign to take product out, like -2.">
                  <Input name="qty" inputMode="decimal" />
                </Field>
                <Field label="Reason">
                  <Textarea name="reason" rows={2} />
                </Field>
              </div>
              <div>
                <SubmitButton pendingLabel="Saving">Save adjustment</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        </div>
      ) : null}

      <section aria-labelledby="variance-heading" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="variance-heading" className="text-md font-semibold">
            Truck checks, last 30 days
          </h2>
          <p className="text-sm text-fg-muted">What the technician counted against what RouteVerde expected to be on the truck. Short means less than expected.</p>
        </div>
        {variances.length === 0 ? (
          <EmptyState title="No truck checks yet">Counts show up here after technicians finish the inventory check on resupply day.</EmptyState>
        ) : (
          <Table label="Truck check variances">
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Truck</TH>
                <TH>Product</TH>
                <TH className="text-right">Counted</TH>
                <TH className="text-right">Expected</TH>
                <TH className="text-right">Difference</TH>
              </tr>
            </THead>
            <TBody>
              {variances.map((r) => {
                const unit = isAmountUnit(r.unit) ? r.unit : null;
                return (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">{r.localDate ? formatLocalDate(r.localDate, "short") : ""}</TD>
                    <TD>{r.location}</TD>
                    <TD className="font-medium">{r.product}</TD>
                    <TD className="text-right whitespace-nowrap tabular">{qtyText(r.counted, unit)}</TD>
                    <TD className="text-right whitespace-nowrap tabular">{r.expected === null ? "-" : qtyText(r.expected, unit)}</TD>
                    <TD className="text-right whitespace-nowrap tabular">
                      {r.variance === null ? (
                        <span className="text-fg-muted">No baseline</span>
                      ) : r.variance === 0 ? (
                        <span className="text-fg-muted">Matches</span>
                      ) : (
                        <span className={r.variance < 0 ? "font-semibold text-danger" : "font-semibold text-warning"}>
                          {r.variance > 0 ? "+" : ""}
                          {qtyText(r.variance, unit)}
                        </span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>
      <p className="text-sm text-fg-muted">
        Set each product&apos;s stock unit and safety days in{" "}
        <Link href="/settings/products" className="font-medium text-accent hover:underline">
          Settings, Products
        </Link>
        .
      </p>
    </div>
  );
}
