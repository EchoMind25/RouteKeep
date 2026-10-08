"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { createVisitAction } from "./actions";

export function OneOffVisitForm(props: {
  customerId: string;
  clientKey: string;
  properties: { id: string; label: string }[];
  serviceTypes: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  today: string;
}) {
  const [state, action] = useActionState(createVisitAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form ref={formRef} action={action} className="grid max-w-2xl gap-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="customerId" value={props.customerId} />
      <input type="hidden" name="clientKey" value={props.clientKey} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address" error={e.propertyId}>
          <Select name="propertyId" defaultValue={v.propertyId ?? props.properties[0]?.id}>
            {props.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Service" error={e.serviceTypeId}>
          <Select name="serviceTypeId" defaultValue={v.serviceTypeId ?? props.serviceTypes[0]?.id}>
            {props.serviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" optional hint="Leave empty to put it in the needs-attention list for the dispatcher." error={e.localDate}>
          <Input name="localDate" type="date" min={props.today} defaultValue={v.localDate} />
        </Field>
        <Field label="Technician" optional error={e.technicianId}>
          <Select name="technicianId" defaultValue={v.technicianId ?? ""}>
            <option value="">Assign later</option>
            {props.technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Window starts" optional error={e.windowStart}>
          <Input name="windowStart" type="time" step={900} defaultValue={v.windowStart} />
        </Field>
        <Field label="Window ends" optional error={e.windowEnd}>
          <Input name="windowEnd" type="time" step={900} defaultValue={v.windowEnd} />
        </Field>
        <Field label="Price" optional hint="Empty for a free callback." error={e.price}>
          <Input name="price" inputMode="decimal" defaultValue={v.price} />
        </Field>
      </div>
      <Field label="Notes for the technician" optional error={e.notes}>
        <Textarea name="notes" rows={3} defaultValue={v.notes} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Adding">Add visit</SubmitButton>
      </div>
    </form>
  );
}
