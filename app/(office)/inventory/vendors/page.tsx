import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/layout";
import { canManage, INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { amountLabel, formatNumber, isAmountUnit } from "@/lib/domain/units";
import { WEEKDAYS } from "@/lib/inventory/ui";
import { listProducts } from "@/lib/server/catalog";
import { listVendorProducts, listVendors } from "@/lib/server/inventory";
import { pluralize } from "@/lib/ui/format";
import { DeletePackageForm, PackageForm, VendorForm } from "./forms";

export const metadata: Metadata = { title: "Vendors" };

// FR-INV-04: who you buy from and what they sell. Owner and admin edit; office reads.
export default async function VendorsPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const manage = canManage(member.role);
  const [vendors, packages, products] = await Promise.all([listVendors(member, { includeInactive: true }), listVendorProducts(member), listProducts(member)]);
  const active = products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="grid items-start gap-6">
      {vendors.length === 0 ? (
        <EmptyState title="No vendors yet">Add the suppliers you order product from, then what each one sells and in which package. That is what turns the forecast into an order.</EmptyState>
      ) : null}

      {vendors.map((v) => {
        const own = packages.filter((p) => p.vendor_id === v.id);
        const days = WEEKDAYS.filter((d) => v.order_weekdays.includes(d.value)).map((d) => d.label.slice(0, 3));
        return (
          <Panel key={v.id} title={v.name} description={[v.email, v.phone, v.account_no ? `Account ${v.account_no}` : null].filter(Boolean).join(", ") || undefined}>
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4 text-sm text-fg-muted">
              {v.active ? null : <Badge>Inactive</Badge>}
              <span>{days.length ? `Orders on ${days.join(", ")}` : "Orders any day"}</span>
              <span aria-hidden>|</span>
              <span>{v.min_order_cents ? `${formatCents(v.min_order_cents)} minimum` : "No minimum"}</span>
              <span aria-hidden>|</span>
              <span>{pluralize(own.length, "package")}</span>
            </div>
            {own.length > 0 ? (
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {own.map((p) => (
                  <li key={p.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p>
                        <span className="font-medium">{p.product_name}</span>{" "}
                        <span className="text-fg-muted">
                          {p.package_label}, {formatNumber(Number(p.package_qty))} {isAmountUnit(p.package_unit) ? amountLabel(p.package_unit) : p.package_unit}
                          {p.price_cents === null ? ", no price" : `, ${formatCents(p.price_cents)}`}, {pluralize(p.lead_time_days, "day")} to arrive
                        </span>{" "}
                        {p.preferred ? <Badge tone="accent">Preferred</Badge> : null}
                      </p>
                    </div>
                    {manage ? (
                      <details className="pt-2">
                        <summary className="w-fit cursor-pointer text-sm font-medium text-accent hover:underline">Edit or delete</summary>
                        <div className="grid gap-4 pt-3">
                          <PackageForm vendorId={v.id} pack={{ ...p, package_qty: String(p.package_qty) }} submitLabel="Save package" />
                          <DeletePackageForm id={p.id} label={`${p.product_name} ${p.package_label}`} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {manage ? (
              <div className="grid gap-2 border-t border-line px-5 py-4">
                <details>
                  <summary className="w-fit cursor-pointer font-medium text-accent hover:underline">Add a package</summary>
                  <div className="pt-3">
                    <PackageForm vendorId={v.id} products={active} submitLabel="Add package" />
                  </div>
                </details>
                <details>
                  <summary className="w-fit cursor-pointer font-medium text-accent hover:underline">Edit vendor</summary>
                  <div className="pt-3">
                    <VendorForm vendor={{ ...v, id: v.id }} submitLabel="Save vendor" />
                  </div>
                </details>
              </div>
            ) : null}
          </Panel>
        );
      })}

      {manage ? (
        <Panel title="Add a vendor" description="RouteVerde only keeps these details. It never contacts a vendor.">
          <div className="px-5 py-4">
            <VendorForm submitLabel="Add vendor" />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
