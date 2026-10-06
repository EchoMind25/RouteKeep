"use client";

import { useActionState, useState } from "react";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { US_STATES, US_TIMEZONES } from "@/lib/domain/contact";
import { PLAN_PRESETS } from "@/lib/domain/recurrence";
import { initialFormState, type FormState } from "@/lib/forms";
import { BILLING_MODE, CATEGORY_LABEL, PRODUCT_KIND, SIGNAL_WORD } from "@/lib/ui/format";
import { AMOUNT_UNITS, amountLabel, MIX_UNITS, mixLabel } from "@/lib/domain/units";
import { createPlan, createProduct, createTechnician, inviteMemberAction, updateBusiness } from "./actions";

function Status({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>;
}

export function BusinessForm({ initial, readOnly }: { initial: Record<string, string>; readOnly: boolean }) {
  const [state, action] = useActionState(updateBusiness, initialFormState);
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid max-w-2xl gap-5" noValidate>
      <Status state={state} />
      <fieldset disabled={readOnly} className="grid gap-5">
        <Field label="Business name" error={e.name}>
          <Input name="name" defaultValue={v.name} />
        </Field>
        <Field label="Pesticide business license number" hint="Printed on every service record and notice." error={e.businessLicenseNo}>
          <Input name="businessLicenseNo" defaultValue={v.businessLicenseNo} className="max-w-72" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="State" error={e.state}>
            <Select name="state" defaultValue={v.state}>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time zone" error={e.timezone}>
            <Select name="timezone" defaultValue={v.timezone}>
              {US_TIMEZONES.map(([zone, label]) => (
                <option key={zone} value={zone}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Street address" error={e.addressLine1}>
          <Input name="addressLine1" defaultValue={v.addressLine1} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_10rem]">
          <Field label="City" error={e.city}>
            <Input name="city" defaultValue={v.city} />
          </Field>
          <Field label="ZIP" error={e.postalCode}>
            <Input name="postalCode" inputMode="numeric" defaultValue={v.postalCode} />
          </Field>
          <Field label="Suite" optional error={e.addressLine2}>
            <Input name="addressLine2" defaultValue={v.addressLine2} />
          </Field>
        </div>
        <Field label="Office phone" optional error={e.phone}>
          <Input name="phone" type="tel" defaultValue={v.phone} className="max-w-72" />
        </Field>
        {!readOnly ? (
          <div>
            <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

export function InviteForm({ isOwner }: { isOwner: boolean }) {
  const [state, action] = useActionState(inviteMemberAction, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" error={e.email}>
          <Input name="email" type="email" autoComplete="off" defaultValue={v.email} />
        </Field>
        <Field label="Name" optional error={e.displayName}>
          <Input name="displayName" defaultValue={v.displayName} />
        </Field>
      </div>
      <Field label="Role" hint="Owners and admins manage settings. Office staff sell plans and take payments. Dispatchers run the schedule." error={e.role}>
        <Select name="role" defaultValue={v.role ?? "office"} className="max-w-60">
          {isOwner ? <option value="owner">Owner</option> : null}
          {isOwner ? <option value="admin">Admin</option> : null}
          <option value="office">Office</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="technician">Technician</option>
        </Select>
      </Field>
      <div>
        <SubmitButton pendingLabel="Sending">Send invitation</SubmitButton>
      </div>
    </form>
  );
}

export function TechnicianForm({ nextColor }: { nextColor: number }) {
  const [state, action] = useActionState(createTechnician, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <input type="hidden" name="colorIndex" value={v.colorIndex ?? nextColor} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.displayName}>
          <Input name="displayName" defaultValue={v.displayName} />
        </Field>
        <Field label="Mobile phone" optional error={e.phone}>
          <Input name="phone" type="tel" defaultValue={v.phone} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Applicator license number" error={e.applicatorLicenseNo}>
          <Input name="applicatorLicenseNo" defaultValue={v.applicatorLicenseNo} />
        </Field>
        <Field label="License expires" error={e.licenseExpiry}>
          <Input name="licenseExpiry" type="date" defaultValue={v.licenseExpiry} />
        </Field>
      </div>
      <Field label="License categories" optional hint="Comma separated, as on the license." error={e.categories}>
        <Input name="categories" defaultValue={v.categories} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Adding">Add technician</SubmitButton>
      </div>
    </form>
  );
}

export function PlanForm({ serviceTypes }: { serviceTypes: { id: string; name: string; category: string }[] }) {
  const [state, action] = useActionState(createPlan, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  const [preset, setPreset] = useState(v.preset ?? PLAN_PRESETS[2].rrule);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan name" hint="What the customer hears, e.g. Quarterly home protection." error={e.name}>
          <Input name="name" defaultValue={v.name} />
        </Field>
        <Field label="Service type" error={e.serviceTypeId}>
          <Select name="serviceTypeId" defaultValue={v.serviceTypeId}>
            {serviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({CATEGORY_LABEL[t.category]})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price per visit" error={e.price}>
          <Input name="price" inputMode="decimal" placeholder="0.00" defaultValue={v.price} />
        </Field>
        <Field label="First visit price" optional hint="Often higher; leave blank to charge the same." error={e.initialPrice}>
          <Input name="initialPrice" inputMode="decimal" placeholder="0.00" defaultValue={v.initialPrice} />
        </Field>
        <Field label="Minutes on site" optional error={e.durationMin}>
          <Input name="durationMin" type="number" min={5} max={600} step={5} defaultValue={v.durationMin} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How often" error={e.preset}>
          <Select name="preset" value={preset} onChange={(ev) => setPreset(ev.target.value)}>
            {PLAN_PRESETS.map((p) => (
              <option key={p.id} value={p.rrule}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom rule</option>
          </Select>
        </Field>
        <Field label="Billing" error={e.billingMode}>
          <Select name="billingMode" defaultValue={v.billingMode ?? "per_service"}>
            {Object.entries(BILLING_MODE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {preset === "custom" ? (
        <Field label="Recurrence rule" hint="Standard RRULE without a start date, e.g. FREQ=MONTHLY;INTERVAL=2;BYMONTH=4,5,6,7,8,9" error={e.customRule}>
          <Input name="customRule" defaultValue={v.customRule} className="font-mono" spellCheck={false} />
        </Field>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Creating">Create plan</SubmitButton>
      </div>
    </form>
  );
}

export function ProductForm() {
  const [state, action] = useActionState(createProduct, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  const [kind, setKind] = useState(v.kind ?? "pesticide");
  const pesticideLike = kind === "pesticide" || kind === "minimum_risk";
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand name" hint="Exactly as printed on the label." error={e.name}>
          <Input name="name" defaultValue={v.name} />
        </Field>
        <Field label="Type" error={e.kind}>
          <Select name="kind" value={kind} onChange={(ev) => setKind(ev.target.value)}>
            {Object.entries(PRODUCT_KIND).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {pesticideLike ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="EPA registration number"
            optional={kind !== "pesticide"}
            hint={kind === "minimum_risk" ? "25(b) products have none; leave blank." : "From the label, e.g. 12345-678."}
            error={e.epaRegNo}
          >
            <Input name="epaRegNo" defaultValue={v.epaRegNo} className="font-mono" spellCheck={false} />
          </Field>
          <Field label="Signal word" optional error={e.signalWord}>
            <Select name="signalWord" defaultValue={v.signalWord ?? ""}>
              <option value="">None on label</option>
              {Object.entries(SIGNAL_WORD).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {kind === "pesticide" ? (
        <Checkbox name="restrictedUse" label="Restricted-use product" hint="With a Danger signal word, technicians must record the customer statement before applying." defaultChecked={v.restrictedUse === "on"} />
      ) : null}
      <Field label="Active ingredients" optional error={e.activeIngredients}>
        <Textarea name="activeIngredients" rows={2} defaultValue={v.activeIngredients} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Default mix rate" optional error={e.defaultMixRate}>
          <Input name="defaultMixRate" inputMode="decimal" defaultValue={v.defaultMixRate} />
        </Field>
        <Field label="Mix rate unit" optional error={e.defaultMixUnit}>
          <Select name="defaultMixUnit" defaultValue={v.defaultMixUnit ?? ""}>
            <option value="">Choose</option>
            {MIX_UNITS.map((u) => (
              <option key={u} value={u}>
                {mixLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Usually recorded in" optional error={e.defaultAmountUnit}>
          <Select name="defaultAmountUnit" defaultValue={v.defaultAmountUnit ?? ""}>
            <option value="">Choose</option>
            {AMOUNT_UNITS.map((u) => (
              <option key={u} value={u}>
                {amountLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Adding">Add product</SubmitButton>
      </div>
    </form>
  );
}
