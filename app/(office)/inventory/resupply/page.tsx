import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/office/action-form";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert, EmptyState, Panel } from "@/components/ui/layout";
import { canManage, INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { resupplySuggestions } from "@/lib/server/inventory";
import { formatLocalDate, pluralize } from "@/lib/ui/format";
import { createDraftAction } from "../actions";

export const metadata: Metadata = { title: "Resupply" };

// FR-INV-05: what to order from each vendor, with the order-by date. The owner decides; nothing is sent from here.
export default async function ResupplyPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const data = await resupplySuggestions(member);
  const tracked = data.mode === "tracked";
  const manage = canManage(member.role);

  return (
    <div className="grid gap-6">
      <p className="max-w-[65ch] text-fg-muted">
        {tracked
          ? "Suggested packages are what the forecast needs for one order cycle plus your safety days, minus what is on hand and on order."
          : "Suggested packages cover the forecast from today until your next order would arrive. Untick anything you already have enough of."}{" "}
        Creating a draft only saves it here. You send it yourself, from your own email or by phone.
      </p>

      {data.vendors.length === 0 ? (
        <EmptyState title="Nothing to order right now">
          Suggestions appear for products that have a preferred package from a vendor and a forecast need. Add vendors and what they sell under{" "}
          <Link href="/inventory/vendors" className="font-medium text-accent hover:underline">
            Vendors
          </Link>
          .
        </EmptyState>
      ) : null}

      {data.vendors.map((v) => (
        <Panel key={v.vendorId} title={v.vendorName} description={`Next order day ${formatLocalDate(v.orderDate)}. ${pluralize(v.lines.length, "product")}.`}>
          <ActionForm action={createDraftAction} className="gap-0">
            <input type="hidden" name="vendorId" value={v.vendorId} />
            {v.belowMinimum && v.minOrderCents !== null ? (
              <div className="px-5 pt-4">
                <Alert tone="warning">
                  This comes to {formatCents(v.totalCents)}, under the vendor&apos;s {formatCents(v.minOrderCents)} minimum. Add more, wait for the next cycle, or order it anyway. Nothing is added for you.
                </Alert>
              </div>
            ) : null}
            <ul className="divide-y divide-line">
              {v.lines.map((l) => (
                <li key={l.vendorProductId} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="grid gap-1">
                    <Checkbox name={`pick:${l.vendorProductId}`} label={l.productName} defaultChecked disabled={!manage} />
                    <p className="pl-[30px] text-sm text-fg-muted">
                      Covers the forecast until {formatLocalDate(l.coverEnd)}. Arrives about {formatLocalDate(l.arrivalDate)}.
                      {l.orderBy ? (
                        <>
                          {" "}
                          Order by {formatLocalDate(l.orderBy)}. {l.late ? <Badge tone="danger">Order today</Badge> : null}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 pl-[30px] sm:pl-0">
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Packages of {l.packageLabel} for {l.productName}</span>
                      <Input name={`packages:${l.vendorProductId}`} type="number" min={1} step={1} inputMode="numeric" defaultValue={l.packages} className="w-20" disabled={!manage} />
                    </label>
                    <span className="text-sm">
                      x {l.packageLabel}
                      <span className="block text-fg-muted tabular">{l.priceCents === null ? "No price set" : `${formatCents(l.priceCents)} each`}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
              <p className="text-sm text-fg-muted">
                <span className="font-semibold text-fg tabular">{formatCents(v.totalCents)}</span> estimated{v.unpriced ? ", without the lines that have no price" : ""}
              </p>
              {manage ? <SubmitButton pendingLabel="Creating">Create draft order</SubmitButton> : <p className="text-sm text-fg-muted">Only the owner or an admin can create orders.</p>}
            </div>
          </ActionForm>
        </Panel>
      ))}

      {data.unsourced.length > 0 ? (
        <Alert tone="neutral" title="No vendor for these products">
          <p>
            The forecast needs {data.unsourced.map((u) => u.name).join(", ")}, but none has a preferred package. Add one under{" "}
            <Link href="/inventory/vendors" className="font-medium underline">
              Vendors
            </Link>
            .
          </p>
        </Alert>
      ) : null}
    </div>
  );
}
