"use client";

import { useActionState, useState } from "react";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { addCreditAction, recordPaymentAction, refundPaymentAction, voidInvoiceAction } from "../../actions";

// FR-BIL-06: money the office takes or forgives. Each form carries a client
// key made when the page was drawn, so a double click records it once.

export function PaymentForm({ invoiceId, paymentKey, openAmount }: { invoiceId: string; paymentKey: string; openAmount: string }) {
  const [state, action] = useActionState(recordPaymentAction, initialFormState);
  const v = state.values ?? { method: "cash", amount: openAmount };
  const e = state.errors ?? {};
  // defaultChecked, not checked: React resets the form after each submit, and
  // a reset falls back to the default, which this keeps on the chosen method.
  const [method, setMethod] = useState(v.method ?? "cash");
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.message && !e.amount ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="key" value={paymentKey} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">How they paid</legend>
        <div className="flex flex-wrap gap-4">
          {(["cash", "check", "other"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="method" value={m} defaultChecked={method === m} onChange={() => setMethod(m)} className="size-4 accent-accent" />
              {m === "cash" ? "Cash" : m === "check" ? "Check" : "Other"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" error={e.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={v.amount} />
        </Field>
        {method === "check" ? (
          <Field label="Check number" error={e.checkNumber}>
            <Input name="checkNumber" defaultValue={v.checkNumber} />
          </Field>
        ) : null}
      </div>
      <Field label="Note" optional error={e.memo}>
        <Input name="memo" defaultValue={v.memo} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Saving">Record payment</SubmitButton>
      </div>
    </form>
  );
}

export function CreditForm({ invoiceId, creditKey }: { invoiceId: string; creditKey: string }) {
  const [state, action] = useActionState(addCreditAction, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="key" value={creditKey} />
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Credit amount" error={e.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={v.amount} />
        </Field>
        <Field label="Reason" hint="Shows on the invoice and the customer's history." error={e.reason}>
          <Input name="reason" defaultValue={v.reason} />
        </Field>
      </div>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving">
          Apply credit
        </SubmitButton>
      </div>
    </form>
  );
}

export function VoidForm({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState(voidInvoiceAction, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.message && !e.reason ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="Why void it" error={e.reason}>
        <Input name="reason" defaultValue={v.reason} />
      </Field>
      <div>
        <SubmitButton variant="danger" pendingLabel="Voiding">
          Void invoice
        </SubmitButton>
      </div>
    </form>
  );
}

export function RefundForm({ invoiceId, paymentId, refundKey, maxAmount }: { invoiceId: string; paymentId: string; refundKey: string; maxAmount: string }) {
  const [state, action] = useActionState(refundPaymentAction, initialFormState);
  const v = state.values ?? { amount: maxAmount, credit: "on" };
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.message && !e.amount ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="key" value={refundKey} />
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Refund amount" error={e.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={v.amount} />
        </Field>
        <Field label="Reason" hint="Kept with the refund in the invoice history." error={e.reason}>
          <Input name="reason" defaultValue={v.reason} />
        </Field>
      </div>
      <Checkbox name="credit" label="Also take it off what they owe" hint="Leave on when the service is being made good. Off means they owe this amount again." defaultChecked={v.credit === "on"} />
      <div>
        <SubmitButton variant="danger" pendingLabel="Refunding">
          Refund to their card or bank
        </SubmitButton>
      </div>
    </form>
  );
}
