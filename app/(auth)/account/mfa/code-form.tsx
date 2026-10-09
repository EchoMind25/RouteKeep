"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import type { CodeState } from "./actions";

/** A 6-digit authenticator code. Shared by enrolment and sign-in (CR-15). */
export function CodeForm({
  action,
  factorId,
  submitLabel,
}: {
  action: (prev: CodeState & { factorId?: string }, data: FormData) => Promise<CodeState & { factorId?: string }>;
  factorId?: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, { factorId });
  return (
    <form action={formAction} className="grid gap-5">
      {factorId ? <input type="hidden" name="factorId" value={factorId} /> : null}
      <Field label="6-digit code" error={state.error}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="max-w-40 tabular tracking-[0.3em]" />
      </Field>
      <div>
        <SubmitButton pendingLabel="Checking">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
