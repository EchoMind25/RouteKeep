"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Fieldset, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { US_STATES } from "@/lib/domain/contact";
import { formatCents } from "@/lib/domain/money";
import { describeRule, occurrences } from "@/lib/domain/recurrence";
import { addDays, isLocalDate, parseLocalDate } from "@/lib/domain/time";
import { initialFormState } from "@/lib/forms";
import { formatLocalDate } from "@/lib/ui/format";
import { createCustomerAction } from "./actions";

export interface PlanOption {
  id: string;
  name: string;
  rrule: string;
  priceCents: number;
  initialPriceCents: number | null;
  serviceType: string;
}

export function CustomerForm(props: {
  plans: PlanOption[];
  technicians: { id: string; name: string }[];
  today: string;
  defaultRegion: string;
  canSell: boolean;
}) {
  const [state, action] = useActionState(createCustomerAction, initialFormState);
  const v = state.values ?? {};
  const e = state.errors ?? {};

  const [kind, setKind] = useState(v.kind ?? "residential");
  const [planId, setPlanId] = useState(v.planId ?? "");
  const [startDate, setStartDate] = useState<string>(v.startDate ?? addDays(parseLocalDate(props.today), 1));
  const plan = props.plans.find((p) => p.id === planId);

  // Show the first visits before saving, from the same code that generates them.
  const preview = useMemo(() => {
    if (!plan || !isLocalDate(startDate)) return [];
    return occurrences(plan.rrule, startDate, startDate, addDays(startDate, 400)).slice(0, 4);
  }, [plan, startDate]);

  return (
    <form action={action} className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]" noValidate>
      <div className="grid gap-10">
        {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

        <Fieldset legend="Customer">
          <div className="flex gap-6" role="radiogroup" aria-label="Customer type">
            {(["residential", "commercial"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 font-medium">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-4 accent-accent" />
                {k === "residential" ? "Home" : "Business"}
              </label>
            ))}
          </div>
          {kind === "commercial" ? (
            <Field label="Business name" error={e.companyName}>
              <Input name="companyName" autoComplete="organization" defaultValue={v.companyName} />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === "commercial" ? "Contact first name" : "First name"} optional={kind === "commercial"} error={e.firstName}>
              <Input name="firstName" autoComplete="given-name" defaultValue={v.firstName} />
            </Field>
            <Field label={kind === "commercial" ? "Contact last name" : "Last name"} optional={kind === "commercial"} error={e.lastName}>
              <Input name="lastName" autoComplete="family-name" defaultValue={v.lastName} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile phone" optional error={e.phone}>
              <Input name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} />
            </Field>
            <Field label="Email" optional error={e.email}>
              <Input name="email" type="email" autoComplete="email" defaultValue={v.email} />
            </Field>
          </div>
          <div className="grid gap-3">
            {/* FR-CRM-04 / CR-07: consent is recorded with time and source. */}
            <Checkbox name="smsConsent" label="Customer agreed to text messages" hint="Ask first. We record when and who took the consent." defaultChecked={v.smsConsent === "on"} />
            <Checkbox name="emailOptIn" label="Customer wants promotional email" hint="Visit reminders and invoices are sent either way." defaultChecked={v.emailOptIn === "on"} />
          </div>
        </Fieldset>

        <Fieldset legend="Service address">
          <Field label="Street address" error={e.line1}>
            <Input name="line1" autoComplete="address-line1" defaultValue={v.line1} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
            <Field label="City" error={e.city}>
              <Input name="city" autoComplete="address-level2" defaultValue={v.city} />
            </Field>
            <Field label="State" error={e.region}>
              <Select name="region" defaultValue={v.region ?? props.defaultRegion} autoComplete="address-level1">
                {US_STATES.map(([code]) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ZIP" error={e.postalCode}>
              <Input name="postalCode" inputMode="numeric" autoComplete="postal-code" defaultValue={v.postalCode} />
            </Field>
          </div>
          <Field label="Unit or suite" optional error={e.line2}>
            <Input name="line2" autoComplete="address-line2" defaultValue={v.line2} className="max-w-60" />
          </Field>
          <Field label="Access notes" optional hint="Gate codes, dogs, where to park. Technicians see this at the stop." error={e.accessNotes}>
            <Textarea name="accessNotes" rows={2} defaultValue={v.accessNotes} />
          </Field>
        </Fieldset>

        <Fieldset legend="Plan" description={props.canSell ? "Optional. Choose one to put the first visits on the schedule now." : "Your role can add customers; the office sells plans."}>
          {props.canSell && props.plans.length > 0 ? (
            <>
              <Field label="Service plan" error={e.planId}>
                <Select name="planId" value={planId} onChange={(ev) => setPlanId(ev.target.value)}>
                  <option value="">No plan yet</option>
                  {props.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}: {formatCents(p.priceCents)}
                    </option>
                  ))}
                </Select>
              </Field>
              {plan ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First visit" error={e.startDate}>
                      <Input name="startDate" type="date" min={props.today} value={startDate} onChange={(ev) => setStartDate(ev.target.value)} />
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Arrival window starts" optional error={e.windowStart}>
                      <Input name="windowStart" type="time" step={900} defaultValue={v.windowStart} />
                    </Field>
                    <Field label="Arrival window ends" optional error={e.windowEnd}>
                      <Input name="windowEnd" type="time" step={900} defaultValue={v.windowEnd} />
                    </Field>
                  </div>
                  <Checkbox name="autopay" label="Customer wants autopay" hint="Card or bank details are collected later through Stripe's secure form, never typed here." defaultChecked={v.autopay === "on"} />
                </>
              ) : null}
            </>
          ) : props.canSell ? (
            <p className="text-fg-muted">
              No plans yet. <Link href="/settings/plans" className="font-medium text-accent underline-offset-4 hover:underline">Create a plan</Link> first, or save the customer now and add one later.
            </p>
          ) : null}
        </Fieldset>

        <Field label="Office notes" optional hint="Internal only; customers never see this." error={e.notes}>
          <Textarea name="notes" rows={3} defaultValue={v.notes} />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton size="lg" pendingLabel="Saving">
            {plan ? "Save and schedule" : "Save customer"}
          </SubmitButton>
        </div>
      </div>

      <aside className="grid gap-3 rounded-panel border border-line bg-surface p-5 lg:sticky lg:top-6" aria-live="polite">
        <h2 className="font-semibold">Schedule preview</h2>
        {plan ? (
          <>
            <p className="text-sm text-fg-muted">{describeRule(plan.rrule, isLocalDate(startDate) ? startDate : undefined)}</p>
            <ol className="grid gap-2">
              {preview.map((d, i) => (
                <li key={d} className="flex items-center justify-between gap-3 tabular">
                  <span>{formatLocalDate(d)}</span>
                  <span className="flex items-center gap-2">
                    {i === 0 ? <Badge tone="accent">First visit</Badge> : null}
                    <span className="text-fg-muted">{formatCents(i === 0 && plan.initialPriceCents !== null ? plan.initialPriceCents : plan.priceCents)}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-fg-muted">Visits are kept 60 days ahead and move with the plan.</p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">Choose a plan to see the first visits here before you save.</p>
        )}
      </aside>
    </form>
  );
}
