"use client";

import { useActionState } from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { saveTenDlcAction } from "./actions";

export function TenDlcForm({ initial, readOnly }: { initial: Record<string, string>; readOnly: boolean }) {
  const [state, action] = useActionState(saveTenDlcAction, initialFormState);
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid max-w-2xl gap-4">
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal business name" error={e.legalName}>
          <Input name="legalName" defaultValue={v.legalName} disabled={readOnly} />
        </Field>
        <Field label="EIN" hint="From your IRS letter" error={e.ein}>
          <Input name="ein" defaultValue={v.ein} inputMode="numeric" disabled={readOnly} />
        </Field>
        <Field label="Website" optional error={e.website}>
          <Input name="website" defaultValue={v.website} placeholder="https://" disabled={readOnly} />
        </Field>
        <Field label="Contact email" error={e.contactEmail}>
          <Input type="email" name="contactEmail" defaultValue={v.contactEmail} disabled={readOnly} />
        </Field>
      </div>
      <Field label="What you will text customers" hint="For example: visit reminders, on-the-way notices and service complete notices for customers who agreed to texts." error={e.useCase}>
        <Textarea name="useCase" rows={2} defaultValue={v.useCase} disabled={readOnly} />
      </Field>
      {!readOnly ? (
        <div>
          <SubmitButton variant="secondary" pendingLabel="Saving">
            Save details
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
