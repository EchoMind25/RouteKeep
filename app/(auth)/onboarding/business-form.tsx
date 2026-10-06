"use client";

import { useActionState } from "react";
import { Field, Fieldset, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { US_STATES, US_TIMEZONES } from "@/lib/domain/contact";
import { initialFormState } from "@/lib/forms";
import { createBusiness } from "./actions";

export function BusinessForm({ clientKey }: { clientKey: string }) {
  const [state, action] = useActionState(createBusiness, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};

  return (
    <form action={action} className="grid gap-8" noValidate>
      <input type="hidden" name="clientKey" value={clientKey} />
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

      <Fieldset legend="Your business" description="These print on every service record and notice, as Utah rule R68-7 requires.">
        <Field label="Business name" error={e.name}>
          <Input name="name" autoComplete="organization" required defaultValue={v.name} />
        </Field>
        <Field label="Pesticide business license number" hint="As it appears on your state license." error={e.businessLicenseNo}>
          <Input name="businessLicenseNo" required defaultValue={v.businessLicenseNo} className="max-w-72" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="State" error={e.state}>
            <Select name="state" defaultValue={v.state ?? "UT"}>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time zone" hint="Visit times and reminders use this zone." error={e.timezone}>
            <Select name="timezone" defaultValue={v.timezone ?? "America/Denver"}>
              {US_TIMEZONES.map(([zone, label]) => (
                <option key={zone} value={zone}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Fieldset>

      <Fieldset legend="Business address" description="Your office or shop. It appears on application records.">
        <Field label="Street address" error={e.addressLine1}>
          <Input name="addressLine1" autoComplete="address-line1" required defaultValue={v.addressLine1} />
        </Field>
        <Field label="Suite or unit" optional error={e.addressLine2}>
          <Input name="addressLine2" autoComplete="address-line2" defaultValue={v.addressLine2} className="max-w-72" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label="City" error={e.city}>
            <Input name="city" autoComplete="address-level2" required defaultValue={v.city} />
          </Field>
          <Field label="ZIP code" error={e.postalCode}>
            <Input name="postalCode" autoComplete="postal-code" inputMode="numeric" required defaultValue={v.postalCode} />
          </Field>
        </div>
        <Field label="Office phone" optional error={e.phone}>
          <Input name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} className="max-w-72" />
        </Field>
      </Fieldset>

      <div>
        <SubmitButton size="lg" pendingLabel="Creating your account">
          Create business
        </SubmitButton>
      </div>
    </form>
  );
}
