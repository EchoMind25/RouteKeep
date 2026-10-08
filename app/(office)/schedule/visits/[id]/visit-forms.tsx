"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState, type FormState } from "@/lib/forms";
import { cancelAction, rescheduleAction, restoreAction, skipAction } from "./actions";

const REASONS = ["Customer not home", "Customer asked to move it", "Weather", "Gate locked or no access", "Technician out", "Duplicate visit"];

function Status({ state }: { state: FormState }) {
  return state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null;
}

function Hidden({ id, version }: { id: string; version: number }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
    </>
  );
}

export function RescheduleForm(props: {
  id: string;
  version: number;
  localDate: string;
  technicianId: string;
  windowStart: string;
  windowEnd: string;
  technicians: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(rescheduleAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form ref={formRef} action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <Hidden id={props.id} version={props.version} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" error={e.localDate}>
          <Input name="localDate" type="date" defaultValue={v.localDate ?? props.localDate} />
        </Field>
        <Field label="Technician" error={e.technicianId}>
          <Select name="technicianId" defaultValue={v.technicianId ?? props.technicianId}>
            <option value="">Unassigned</option>
            {props.technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Window starts" optional error={e.windowStart}>
          <Input name="windowStart" type="time" step={900} defaultValue={v.windowStart ?? props.windowStart} />
        </Field>
        <Field label="Window ends" optional error={e.windowEnd}>
          <Input name="windowEnd" type="time" step={900} defaultValue={v.windowEnd ?? props.windowEnd} />
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving">Save this visit</SubmitButton>
      </div>
    </form>
  );
}

export function ReasonForm({ id, version, kind }: { id: string; version: number; kind: "skip" | "cancel" }) {
  const [state, action] = useActionState(kind === "skip" ? skipAction : cancelAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const e = state.errors ?? {};
  const listId = `reasons-${kind}`;
  return (
    <form ref={formRef} action={action} className="grid gap-3" noValidate>
      <Status state={state} />
      <Hidden id={id} version={version} />
      <Field label={kind === "skip" ? "Why is it skipped?" : "Why is it cancelled?"} error={e.reason}>
        <Input name="reason" list={listId} defaultValue={state.values?.reason} autoComplete="off" />
      </Field>
      <datalist id={listId}>
        {REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div>
        <SubmitButton variant={kind === "cancel" ? "danger" : "secondary"} pendingLabel="Saving">
          {kind === "skip" ? "Skip this visit" : "Cancel this visit"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function RestoreForm({ id, version }: { id: string; version: number }) {
  const [state, action] = useActionState(restoreAction, initialFormState);
  return (
    <form action={action} className="grid gap-3">
      <Status state={state} />
      <Hidden id={id} version={version} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Restoring">
          Restore visit
        </SubmitButton>
      </div>
    </form>
  );
}
