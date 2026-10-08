"use client";

import { useActionState, useState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { saveBrandAction } from "./actions";

export function BrandForm({ accent, readOnly }: { accent: string | null; readOnly: boolean }) {
  const [state, action] = useActionState(saveBrandAction, initialFormState);
  const [value, setValue] = useState(state.values?.accent ?? accent ?? "");
  return (
    <section aria-labelledby="brand-title" className="grid max-w-2xl gap-4 border-t border-line pt-8">
      <div className="grid gap-1">
        <h2 id="brand-title" className="text-md font-semibold">
          Your colour
        </h2>
        <p className="text-sm text-fg-muted">White label: your logo, name and colour across the office app, the tech app and your customers&apos; accounts.</p>
      </div>
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input
          type="color"
          aria-label="Pick a colour"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#a8401a"}
          onChange={(e) => setValue(e.currentTarget.value)}
          disabled={readOnly}
          className="size-9 rounded-control border border-line-strong"
        />
        <Field label="Brand colour" hint="Leave empty for the standard colour">
          <Input name="accent" value={value} onChange={(e) => setValue(e.currentTarget.value)} placeholder="#0b3d2e" className="w-32" disabled={readOnly} />
        </Field>
        {!readOnly ? (
          <SubmitButton variant="secondary" pendingLabel="Saving">
            Save colour
          </SubmitButton>
        ) : null}
      </form>
    </section>
  );
}
