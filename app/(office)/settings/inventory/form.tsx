"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, Fieldset, Select } from "@/components/ui/field";
import { SubmitButton, useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { initialFormState } from "@/lib/forms";
import { WEEKDAYS } from "@/lib/inventory/ui";
import { saveInventorySettingsAction } from "./actions";

// FR-INV-01: each mode in plain language.
const MODES = [
  {
    value: "off",
    title: "Off",
    body: "Inventory stays out of the way. Nothing changes for your technicians or your team. You can still see how much product was used in Reports.",
  },
  {
    value: "forecast",
    title: "Forecast only",
    body: "RouteVerde looks at the visits on your schedule and what past visits used, and tells you how much product you will need this week, the next three weeks and the rest of the month. It makes a shopping list by vendor. Nobody counts anything.",
  },
  {
    value: "tracked",
    title: "Track stock in the shop and on trucks",
    body: "Everything in forecast, plus RouteVerde keeps how much product is in your shop and on each truck. You receive orders into a location and move product from the shop to a truck. On your resupply day each technician counts their truck in the app, and you see counted against expected.",
  },
] as const;

export function InventorySettingsForm({ initial, readOnly }: { initial: { mode: string; resupplyWeekday: string }; readOnly: boolean }) {
  const [state, action] = useActionState(saveInventorySettingsAction, initialFormState);
  const formRef = useFocusFirstInvalid(state);
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const [mode, setMode] = useState(v.mode ?? "off");
  return (
    <form ref={formRef} action={action} className="grid max-w-2xl gap-8" noValidate>
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      {readOnly ? <Alert>Only the owner or an admin can change these.</Alert> : null}
      <fieldset disabled={readOnly} className="grid gap-8">
        <Fieldset legend="How do you want to use inventory?" description="You can change this at any time. Turning it off keeps what you entered.">
          <div className="grid gap-3">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-panel border bg-surface p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                  mode === m.value ? "border-accent" : "border-line hover:border-line-strong",
                )}
              >
                <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-1 size-[18px] shrink-0 accent-accent" />
                <span className="grid gap-1">
                  <span className="font-medium text-fg">{m.title}</span>
                  <span className="text-sm text-fg-muted">{m.body}</span>
                </span>
              </label>
            ))}
          </div>
          {e.mode ? <p className="text-sm font-medium text-danger">{e.mode}</p> : null}
        </Fieldset>
        {mode === "tracked" ? (
          <Field
            label="Resupply day"
            hint="The day you restock the trucks. Each technician with a truck gets an inventory check in their app that day, and the restock list counts visits up to the next one."
            error={e.resupplyWeekday}
          >
            <Select name="resupplyWeekday" defaultValue={v.resupplyWeekday ?? ""} className="max-w-60">
              <option value="">Choose a day</option>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {mode !== "off" ? (
          <p className="text-sm text-fg-muted">
            Add your vendors and what they sell under <Link href="/inventory/vendors" className="font-medium text-accent hover:underline">Inventory, Vendors</Link>, and set each product&apos;s stock unit in{" "}
            <Link href="/settings/products" className="font-medium text-accent hover:underline">Settings, Products</Link>. RouteVerde never contacts a vendor for you.
          </p>
        ) : null}
        {readOnly ? null : (
          <div>
            <SubmitButton pendingLabel="Saving">Save inventory settings</SubmitButton>
          </div>
        )}
      </fieldset>
    </form>
  );
}
