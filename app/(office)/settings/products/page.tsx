import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { amountLabel, formatNumber, isAmountUnit, isMixUnit, mixLabel } from "@/lib/domain/units";
import { listProducts } from "@/lib/server/catalog";
import { PRODUCT_KIND, SIGNAL_WORD } from "@/lib/ui/format";
import { ProductForm, ProductStockForm } from "../forms";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const member = await requireMember(OFFICE_ROLES);
  const products = await listProducts(member);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_30rem]">
      {products.length === 0 ? (
        <EmptyState title="No products yet">
          Add the products your technicians apply, copied from the label. The EPA registration number and signal word go onto every application record automatically.
        </EmptyState>
      ) : (
        <Table label="Products">
          <THead>
            <tr>
              <TH>Product</TH>
              <TH>EPA reg. no.</TH>
              <TH className="hidden md:table-cell">Default mix</TH>
              <TH>Stock</TH>
            </tr>
          </THead>
          <TBody>
            {products.map((p) => (
              <TR key={p.id}>
                <TD>
                  <p className="font-medium">{p.name}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge>{PRODUCT_KIND[p.kind]}</Badge>
                    {p.signal_word ? <Badge tone={p.signal_word.startsWith("danger") ? "danger" : "warning"}>{SIGNAL_WORD[p.signal_word]}</Badge> : null}
                    {p.restricted_use ? <Badge tone="danger">Restricted use</Badge> : null}
                  </div>
                </TD>
                <TD className="font-mono text-sm whitespace-nowrap">{p.epa_reg_no ?? <span className="font-sans text-fg-muted">None</span>}</TD>
                <TD className="hidden text-sm text-fg-muted md:table-cell">
                  {p.default_mix_rate && p.default_mix_unit && isMixUnit(p.default_mix_unit) ? `${formatNumber(Number(p.default_mix_rate))} ${mixLabel(p.default_mix_unit)}` : "Not set"}
                </TD>
                <TD className="text-sm">
                  <span className="text-fg-muted">
                    {p.stock_unit && isAmountUnit(p.stock_unit) ? amountLabel(p.stock_unit) : "Automatic unit"}, {p.safety_days} safety {p.safety_days === 1 ? "day" : "days"}
                  </span>
                  {canManage(member.role) ? (
                    <details>
                      <summary className="w-fit cursor-pointer font-medium text-accent hover:underline">Change</summary>
                      <ProductStockForm id={p.id} stockUnit={p.stock_unit} safetyDays={p.safety_days} />
                    </details>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {canManage(member.role) ? (
        <Panel title="Add a product" description="Copy every value from the product label.">
          <div className="px-5 py-4">
            <ProductForm />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
