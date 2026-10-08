"use client";

import { useActionState, useState } from "react";
import { Checkbox, Field, Fieldset, Input } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { commissionFor } from "@/lib/domain/commission";
import { formatCents, parseMoneyToCents } from "@/lib/domain/money";
import { initialFormState } from "@/lib/forms";
import { saveSalesSettingsAction } from "./actions";

function preview(flat: string, pct: string, basisCents: number): string | null {
  try {
    const flatCents = flat.trim() ? parseMoneyToCents(flat) : 0;
    const p = pct.trim() ? Number(pct.replace(/%$/, "")) : 0;
    if (!Number.isFinite(p) || p < 0 || p > 100) return null;
    return formatCents(commissionFor({ flatCents, pct: p }, basisCents));
  } catch {
    return null;
  }
}

export function SalesSettingsForm({ initial, readOnly, examplePlan }: { initial: Record<string, string>; readOnly: boolean; examplePlan: { name: string; basisCents: number } | null }) {
  const [state, action] = useActionState(saveSalesSettingsAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const [flat, setFlat] = useState(v.flat ?? "");
  const [pct, setPct] = useState(v.pct ?? "");
  const example = examplePlan ? preview(flat, pct, examplePlan.basisCents) : null;
  return (
    <form ref={formRef} action={action} className="grid max-w-2xl gap-8" noValidate>
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      {readOnly ? <Alert>Only the owner or an admin can change these.</Alert> : null}
      <fieldset disabled={readOnly} className="grid gap-8">
        <Checkbox
          name="enabled"
          label="Technicians can add customers"
          hint="From the technician app, with a connection. Each customer is credited to the technician who added it."
          defaultChecked={v.enabled === "on"}
        />
        <Fieldset legend="Commission per sale" description="A flat amount, a percent of the plan's first service price, or both. Either can be zero.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Flat amount" error={e.flat}>
              <Input name="flat" inputMode="decimal" placeholder="0.00" value={flat} onChange={(ev) => setFlat(ev.target.value)} />
            </Field>
            <Field label="Percent of first service" error={e.pct}>
              <Input name="pct" inputMode="decimal" placeholder="0" value={pct} onChange={(ev) => setPct(ev.target.value)} />
            </Field>
          </div>
          {examplePlan && example ? (
            <p className="text-sm text-fg-muted" aria-live="polite">
              A sale of {examplePlan.name} would earn <span className="font-semibold text-fg tabular">{example}</span>.
            </p>
          ) : null}
        </Fieldset>
        {readOnly ? null : (
          <div>
            <SubmitButton pendingLabel="Saving">Save sales settings</SubmitButton>
          </div>
        )}
      </fieldset>
    </form>
  );
}
