"use client";

import { useActionState } from "react";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState, type FormState } from "@/lib/forms";
import { cancelPlanAction, changeSeriesAction, pauseAction, reactivateAction, resumeAction } from "./actions";

function Status({ state }: { state: FormState }) {
  return state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null;
}

interface Ids {
  id: string;
  customerId: string;
  version: number;
}

function Hidden({ id, customerId, version }: Ids) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="version" value={version} />
    </>
  );
}

export function SeriesForm(
  props: Ids & {
    technicianId: string;
    windowStart: string;
    windowEnd: string;
    price: string;
    durationMin: number;
    technicians: { id: string; name: string }[];
  },
) {
  const [state, action] = useActionState(changeSeriesAction, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <Hidden {...props} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Technician" error={e.technicianId}>
          <Select name="technicianId" defaultValue={v.technicianId ?? props.technicianId}>
            <option value="">Assign each visit later</option>
            {props.technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price per visit" error={e.price}>
          <Input name="price" inputMode="decimal" defaultValue={v.price ?? props.price} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Window starts" optional error={e.windowStart}>
          <Input name="windowStart" type="time" step={900} defaultValue={v.windowStart ?? props.windowStart} />
        </Field>
        <Field label="Window ends" optional error={e.windowEnd}>
          <Input name="windowEnd" type="time" step={900} defaultValue={v.windowEnd ?? props.windowEnd} />
        </Field>
        <Field label="Minutes on site" error={e.durationMin}>
          <Input name="durationMin" type="number" min={5} max={600} step={5} defaultValue={v.durationMin ?? props.durationMin} />
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving">Apply to all future visits</SubmitButton>
      </div>
    </form>
  );
}

export function PauseForm(props: Ids & { today: string }) {
  const [state, action] = useActionState(pauseAction, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <Hidden {...props} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pause from" error={e.from}>
          <Input name="from" type="date" min={props.today} defaultValue={v.from ?? props.today} />
        </Field>
        <Field label="Resume on" optional hint="Leave empty to pause until someone resumes it." error={e.until}>
          <Input name="until" type="date" min={props.today} defaultValue={v.until} />
        </Field>
      </div>
      <Field label="Reason" error={e.reason}>
        <Input name="reason" defaultValue={v.reason} list="pause-reasons" autoComplete="off" />
      </Field>
      <datalist id="pause-reasons">
        <option value="Customer travelling" />
        <option value="Off season" />
        <option value="Waiting on payment" />
        <option value="Home for sale" />
      </datalist>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Pausing">
          Pause plan
        </SubmitButton>
      </div>
    </form>
  );
}

export function SimpleForm({ kind, ...ids }: Ids & { kind: "resume" | "reactivate" }) {
  const [state, action] = useActionState(kind === "resume" ? resumeAction : reactivateAction, initialFormState);
  return (
    <form action={action} className="grid gap-3">
      <Status state={state} />
      <Hidden {...ids} />
      <div>
        <SubmitButton pendingLabel="Working">{kind === "resume" ? "Resume now" : "Reactivate plan"}</SubmitButton>
      </div>
    </form>
  );
}

export function CancelPlanForm(props: Ids & { futureVisits: number; futureDetached: number }) {
  const [state, action] = useActionState(cancelPlanAction, initialFormState);
  const e = state.errors ?? {};
  const untouched = props.futureVisits - props.futureDetached;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <Status state={state} />
      <Hidden {...props} />
      {/* UX-03: say exactly what will happen before it happens. */}
      <p className="text-sm text-fg-muted">
        {props.futureVisits === 0
          ? "No future visits are scheduled for this plan."
          : `${untouched} future ${untouched === 1 ? "visit" : "visits"} will be removed.${props.futureDetached ? ` ${props.futureDetached} arranged by hand will be cancelled and listed for follow-up.` : ""} Past visits and records are kept. You can reactivate the plan later.`}
      </p>
      <Field label="Reason" error={e.reason}>
        <Input name="reason" defaultValue={state.values?.reason} list="cancel-reasons" autoComplete="off" />
      </Field>
      <datalist id="cancel-reasons">
        <option value="Moved away" />
        <option value="Price" />
        <option value="Switched provider" />
        <option value="No longer needed" />
      </datalist>
      <div>
        <SubmitButton variant="danger" pendingLabel="Cancelling">
          Cancel plan
        </SubmitButton>
      </div>
    </form>
  );
}
