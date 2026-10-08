"use client";

import { useActionState } from "react";
import { Field, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { sendSwitchNoticeAction } from "./actions";

export function SwitchNoticeForm({ audience }: { audience: number }) {
  const [state, action] = useActionState(sendSwitchNoticeAction, initialFormState);
  return (
    <form action={action} className="grid max-w-2xl gap-4">
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      <Field label="Your note" optional hint="Leave empty for: your visits, service records and invoices are now in one place you can check any time.">
        <Textarea name="message" rows={3} maxLength={1000} />
      </Field>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Queuing" disabled={audience === 0}>
          {`Email ${audience} ${audience === 1 ? "customer" : "customers"}`}
        </SubmitButton>
      </div>
    </form>
  );
}
