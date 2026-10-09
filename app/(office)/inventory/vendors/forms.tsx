import { ActionForm } from "@/components/office/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { centsToInput } from "@/lib/domain/money";
import { AMOUNT_UNITS, amountLabel, isAmountUnit } from "@/lib/domain/units";
import { WEEKDAYS } from "@/lib/inventory/ui";
import { deleteVendorProductAction, saveVendorAction, saveVendorProductAction } from "../actions";

// FR-INV-04: vendor and package forms. Server components; ActionForm carries the client state.

export interface VendorValues {
  id?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  account_no?: string | null;
  order_weekdays?: number[];
  min_order_cents?: number | null;
  notes?: string | null;
  active?: boolean;
}

export function VendorForm({ vendor, submitLabel }: { vendor?: VendorValues; submitLabel: string }) {
  return (
    <ActionForm action={saveVendorAction}>
      {vendor?.id ? <input type="hidden" name="id" value={vendor.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor name">
          <Input name="name" defaultValue={vendor?.name} />
        </Field>
        <Field label="Account number" optional>
          <Input name="accountNo" defaultValue={vendor?.account_no ?? ""} />
        </Field>
        <Field label="Order email" optional hint="Fills the address when you email an order from your own mail app.">
          <Input name="email" type="email" autoComplete="off" defaultValue={vendor?.email ?? ""} />
        </Field>
        <Field label="Phone" optional>
          <Input name="phone" type="tel" autoComplete="off" defaultValue={vendor?.phone ?? ""} />
        </Field>
        <Field label="Minimum order" optional hint="Orders under this are flagged, never padded.">
          <Input name="minOrder" inputMode="decimal" placeholder="0.00" defaultValue={vendor?.min_order_cents ? centsToInput(vendor.min_order_cents) : ""} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="font-medium text-fg">Days you order from this vendor</legend>
        <p className="text-sm text-fg-muted">Suggestions use the next of these days. Leave all unticked if you can order any day.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {WEEKDAYS.map((d) => (
            <div key={d.value} className="w-[7.5rem]">
              <Checkbox name={`wd${d.value}`} label={d.label} defaultChecked={vendor?.order_weekdays?.includes(d.value) ?? false} />
            </div>
          ))}
        </div>
      </fieldset>
      <Field label="Notes" optional>
        <Textarea name="notes" rows={2} defaultValue={vendor?.notes ?? ""} />
      </Field>
      {vendor?.id ? <Checkbox name="active" label="Active" hint="Inactive vendors are left out of suggestions." defaultChecked={vendor.active ?? true} /> : null}
      <div>
        <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export interface PackageValues {
  id?: string;
  sku?: string | null;
  package_label?: string;
  package_qty?: string;
  package_unit?: string;
  price_cents?: number | null;
  lead_time_days?: number;
  preferred?: boolean;
}

export function PackageForm({
  vendorId,
  pack,
  products,
  submitLabel,
}: {
  vendorId: string;
  pack?: PackageValues;
  products?: { id: string; name: string }[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={saveVendorProductAction}>
      {pack?.id ? <input type="hidden" name="id" value={pack.id} /> : <input type="hidden" name="vendorId" value={vendorId} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products ? (
          <Field label="Product">
            <Select name="productId" defaultValue="">
              <option value="">Choose a product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Package" hint="How the vendor sells it, like 1 gal jug.">
          <Input name="packageLabel" defaultValue={pack?.package_label} />
        </Field>
        <Field label="Item number" optional>
          <Input name="sku" defaultValue={pack?.sku ?? ""} />
        </Field>
        <Field label="Amount in one package">
          <Input name="packageQty" inputMode="decimal" defaultValue={pack?.package_qty ? String(Number(pack.package_qty)) : ""} />
        </Field>
        <Field label="Unit">
          <Select name="packageUnit" defaultValue={pack?.package_unit && isAmountUnit(pack.package_unit) ? pack.package_unit : "gal"}>
            {AMOUNT_UNITS.map((u) => (
              <option key={u} value={u}>
                {amountLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price per package" optional>
          <Input name="price" inputMode="decimal" placeholder="0.00" defaultValue={pack?.price_cents != null ? centsToInput(pack.price_cents) : ""} />
        </Field>
        <Field label="Days to arrive" hint="From ordering to the door.">
          <Input name="leadTimeDays" type="number" min={0} max={60} step={1} inputMode="numeric" defaultValue={pack?.lead_time_days ?? 2} />
        </Field>
      </div>
      <Checkbox name="preferred" label="Preferred for this product" hint="Resupply suggestions use the preferred package. Only one per product." defaultChecked={pack?.preferred ?? false} />
      <div>
        <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeletePackageForm({ id, label }: { id: string; label: string }) {
  return (
    <ActionForm action={deleteVendorProductAction} className="gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <ConfirmSubmitButton variant="ghost" size="sm" confirmLabel="Press again to delete" pendingLabel="Deleting" aria-label={`Delete ${label}`}>
          Delete
        </ConfirmSubmitButton>
      </div>
    </ActionForm>
  );
}
