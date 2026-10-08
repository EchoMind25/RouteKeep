"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Fieldset, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { AMOUNT_UNITS, AREA_UNITS, amountLabel, areaLabel, MIX_UNITS, mixLabel } from "@/lib/domain/units";
import { initialFormState } from "@/lib/forms";
import { amendRecordAction } from "./actions";

export interface AmendProduct {
  id: string;
  label: string;
}

/** FR-REC-03: every field that can be corrected, prefilled from the current version. */
export function AmendForm({ initial, products, visitId }: { initial: Record<string, string>; products: AmendProduct[]; visitId: string }) {
  const [state, action] = useActionState(amendRecordAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  return (
    <form ref={formRef} action={action} className="grid max-w-2xl gap-6" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="recordId" value={initial.recordId} />
      <input type="hidden" name="key" value={initial.key} />

      <Field label="Product" error={e.productId}>
        <Select name="productId" defaultValue={v.productId}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field label="Mix rate" error={e.mixRate}>
          <Input name="mixRate" inputMode="decimal" defaultValue={v.mixRate} />
        </Field>
        <Field label="Mix rate unit" error={e.mixUnit}>
          <Select name="mixUnit" defaultValue={v.mixUnit}>
            {MIX_UNITS.map((u) => (
              <option key={u} value={u}>
                {mixLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field label="Total applied" error={e.totalAmount}>
          <Input name="totalAmount" inputMode="decimal" defaultValue={v.totalAmount} />
        </Field>
        <Field label="Total applied unit" error={e.amountUnit}>
          <Select name="amountUnit" defaultValue={v.amountUnit}>
            {AMOUNT_UNITS.map((u) => (
              <option key={u} value={u}>
                {amountLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field label="Area treated" error={e.areaTreated}>
          <Input name="areaTreated" inputMode="decimal" defaultValue={v.areaTreated} />
        </Field>
        <Field label="Area treated unit" error={e.areaUnit}>
          <Select name="areaUnit" defaultValue={v.areaUnit}>
            {AREA_UNITS.map((u) => (
              <option key={u} value={u}>
                {areaLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Target sites" hint="Separate with commas." error={e.targetSites}>
        <Input name="targetSites" defaultValue={v.targetSites} />
      </Field>
      <Field label="Target pests" hint="Separate with commas." error={e.targetPests}>
        <Input name="targetPests" defaultValue={v.targetPests} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Applied on" error={e.appliedDate}>
          <Input type="date" name="appliedDate" defaultValue={v.appliedDate} />
        </Field>
        <Field label="Applied at" error={e.appliedTime}>
          <Input type="time" name="appliedTime" defaultValue={v.appliedTime} />
        </Field>
      </div>
      <Fieldset legend="Customer statement" description="Only for restricted-use products with a Danger signal word: when the customer gave the written statement.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Given on" optional error={e.statementDate}>
            <Input type="date" name="statementDate" defaultValue={v.statementDate} />
          </Field>
          <Field label="Given at" optional error={e.statementTime}>
            <Input type="time" name="statementTime" defaultValue={v.statementTime} />
          </Field>
        </div>
      </Fieldset>

      <Field label="Reason for the amendment" hint="Kept with the record. For example: total was keyed in the wrong unit." error={e.reason}>
        <Textarea name="reason" rows={3} defaultValue={v.reason} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving">Save amendment</SubmitButton>
        <Link href={`/schedule/visits/${visitId}`} className="font-medium text-fg-muted hover:text-fg">
          Cancel
        </Link>
      </div>
    </form>
  );
}
