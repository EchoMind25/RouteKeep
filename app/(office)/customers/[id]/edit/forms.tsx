"use client";

import { useActionState, useState } from "react";
import { Checkbox, Field, Fieldset, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { US_STATES } from "@/lib/domain/contact";
import { initialFormState } from "@/lib/forms";
import { savePropertyAction, updateCustomerAction } from "./actions";

export function CustomerEditForm({ initial }: { initial: Record<string, string> }) {
  const [state, action] = useActionState(updateCustomerAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const [kind, setKind] = useState(v.kind ?? "residential");
  return (
    <form ref={formRef} action={action} className="grid max-w-2xl gap-8" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="version" value={initial.version} />
      <Fieldset legend="Customer">
        <div className="flex gap-6" role="radiogroup" aria-label="Customer type">
          {(["residential", "commercial"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 font-medium">
              <input type="radio" name="kind" value={k} defaultChecked={kind === k} onChange={() => setKind(k)} className="size-4 accent-accent" />
              {k === "residential" ? "Home" : "Business"}
            </label>
          ))}
        </div>
        {kind === "commercial" ? (
          <Field label="Business name" error={e.companyName}>
            <Input name="companyName" defaultValue={v.companyName} />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={e.firstName}>
            <Input name="firstName" defaultValue={v.firstName} />
          </Field>
          <Field label="Last name" error={e.lastName}>
            <Input name="lastName" defaultValue={v.lastName} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile phone" optional error={e.phone}>
            <Input name="phone" type="tel" defaultValue={v.phone} />
          </Field>
          <Field label="Email" optional error={e.email}>
            <Input name="email" type="email" defaultValue={v.email} />
          </Field>
        </div>
        <div className="grid gap-3">
          <Checkbox name="smsConsent" label="Customer agrees to text messages" hint="Unchecking records an opt-out; the original consent stays on file." defaultChecked={v.smsConsent === "on"} />
          <Checkbox name="emailOptIn" label="Customer wants promotional email" defaultChecked={v.emailOptIn === "on"} />
        </div>
        <Field label="Status" hint="Inactive customers stay on file with their history." error={e.status}>
          <Select name="status" defaultValue={v.status} className="max-w-60">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      </Fieldset>
      <Field label="Office notes" optional error={e.notes}>
        <Textarea name="notes" rows={3} defaultValue={v.notes} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Saving">Save customer</SubmitButton>
      </div>
    </form>
  );
}

export function PropertyForm({ customerId, initial, locked }: { customerId: string; initial?: Record<string, string>; locked?: boolean }) {
  const [state, action] = useActionState(savePropertyAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? initial ?? {};
  const e = state.errors ?? {};
  return (
    <form ref={formRef} action={action} className="grid max-w-2xl gap-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {locked ? (
        <Alert tone="warning">This pin was confirmed and locked. Changing the address keeps the pin where it is and flags it for a check.</Alert>
      ) : null}
      <input type="hidden" name="customerId" value={customerId} />
      {initial?.propertyId ? <input type="hidden" name="propertyId" value={initial.propertyId} /> : null}
      {initial?.version ? <input type="hidden" name="version" value={initial.version} /> : null}
      <Field label="Street address" error={e.line1}>
        <Input name="line1" autoComplete="address-line1" defaultValue={v.line1} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
        <Field label="City" error={e.city}>
          <Input name="city" autoComplete="address-level2" defaultValue={v.city} />
        </Field>
        <Field label="State" error={e.region}>
          <Select name="region" defaultValue={v.region ?? "UT"}>
            {US_STATES.map(([code]) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ZIP" error={e.postalCode}>
          <Input name="postalCode" inputMode="numeric" defaultValue={v.postalCode} />
        </Field>
      </div>
      <Field label="Unit or suite" optional error={e.line2}>
        <Input name="line2" defaultValue={v.line2} className="max-w-60" />
      </Field>
      <Field label="Access notes" optional hint="Gate codes, dogs, where to park." error={e.accessNotes}>
        <Textarea name="accessNotes" rows={2} defaultValue={v.accessNotes} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building square feet" optional error={e.sqFt}>
          <Input name="sqFt" inputMode="numeric" defaultValue={v.sqFt} />
        </Field>
        <Field label="Lawn square feet" optional hint="Used for lawn rates and product amounts." error={e.lawnAreaSqFt}>
          <Input name="lawnAreaSqFt" inputMode="numeric" defaultValue={v.lawnAreaSqFt} />
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving">{initial?.propertyId ? "Save address" : "Add address"}</SubmitButton>
      </div>
    </form>
  );
}
