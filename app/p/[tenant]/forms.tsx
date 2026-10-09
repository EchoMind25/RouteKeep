"use client";

import { useActionState, useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { requestLinkAction, requestServiceAction } from "./actions";

export function SignInForm({ tenant }: { tenant: string }) {
  const [state, action] = useActionState(requestLinkAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  return (
    <form ref={formRef} action={action} className="grid max-w-md gap-4">
      <input type="hidden" name="tenant" value={tenant} />
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      {/* NFR-05, WCAG 3.3.1: the error is tied to the field it is about. */}
      <Field label="Email" error={state.errors?.email}>
        <Input type="email" name="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Sending">Email me a sign-in link</SubmitButton>
      </div>
    </form>
  );
}

export function RequestServiceForm({ tenant, properties }: { tenant: string; properties: { id: string; address: string }[] }) {
  const [state, action] = useActionState(requestServiceAction, initialFormState);
  const [key] = useState(() => `req-${crypto.randomUUID()}`);
  const formRef = useFocusFirstInvalid(state);
  if (state.ok) return <Alert tone="success">{state.message}</Alert>;
  return (
    <form ref={formRef} action={action} className="grid gap-4">
      <input type="hidden" name="tenant" value={tenant} />
      <input type="hidden" name="key" value={key} />
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {properties.length > 1 ? (
        <Field label="Where">
          <Select name="propertyId" defaultValue={properties[0]!.id}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="propertyId" value={properties[0]?.id ?? ""} />
      )}
      <Field label="What do you need?" error={state.errors?.message}>
        <Textarea name="message" rows={3} required defaultValue={state.values?.message} placeholder="Ants in the kitchen again, wasps by the back door..." />
      </Field>
      <Field label="Good days or times" optional>
        <Input name="preferred" placeholder="Weekday mornings" />
      </Field>
      <div>
        <SubmitButton pendingLabel="Sending">Send request</SubmitButton>
      </div>
    </form>
  );
}
