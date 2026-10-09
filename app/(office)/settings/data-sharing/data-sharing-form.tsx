"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import {
  changeNotice,
  DEFAULT_SHARING,
  HOW_IT_HELPS,
  isSharingLevel,
  NEVER_COLLECTED,
  PERSON_CHOICE,
  SHARING_LEVELS,
  SHARING_OPTIONS,
  TRACKED,
  type SharingLevel,
} from "@/lib/domain/data-sharing";
import { initialFormState } from "@/lib/forms";
import { saveDataSharing } from "./actions";

function TrackedList() {
  return (
    <ul className="grid list-disc gap-1 pl-5 text-sm text-fg-muted">
      {TRACKED.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

// OPS-04: the product data question. "settings" is the card on Settings >
// Business; "onboarding" is the prominent, skippable version on /setup that a
// new business sees before it has answered (opt-in, default none).
export function DataSharingForm({
  level,
  answered,
  changedLabel,
  readOnly,
  variant = "settings",
  skipHref,
}: {
  level: SharingLevel;
  answered: boolean;
  changedLabel?: string;
  readOnly: boolean;
  variant?: "settings" | "onboarding";
  skipHref?: string;
}) {
  const [state, action] = useActionState(saveDataSharing, initialFormState);
  const savedNow = state.ok && isSharingLevel(state.values?.level);
  const saved = savedNow ? (state.values!.level as SharingLevel) : level;
  const [choice, setChoice] = useState<SharingLevel>(level);
  const notice = changeNotice(saved, choice);
  const canSave = Boolean(notice) || (!answered && !savedNow);
  const onboarding = variant === "onboarding";
  const titleId = `data-sharing-title-${variant}`;

  return (
    <section
      id={onboarding ? "product-data" : "data-sharing"}
      aria-labelledby={titleId}
      className={onboarding ? "grid max-w-3xl gap-5 rounded-panel border border-accent bg-surface px-5 py-5 shadow-raised" : "grid max-w-2xl gap-4 border-t border-line pt-8"}
    >
      <div className="grid gap-1">
        <h2 id={titleId} className={onboarding ? "text-lg font-semibold" : "text-md font-semibold"}>
          {onboarding ? "Help us improve RouteVerde?" : "Product improvement data"}
        </h2>
        <p className="text-sm text-fg-muted">
          {onboarding
            ? "Nothing is shared unless you choose to. You can change this any time in Settings, Business."
            : "Nothing is shared unless you choose to. Error reports and counts of how auto routes are used help us fix problems and make routes better."}
        </p>
      </div>

      {onboarding ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-fg">If you share, we record only this:</p>
          <TrackedList />
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">How it helps: </span>
            {HOW_IT_HELPS}
          </p>
        </div>
      ) : null}

      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      <form action={action} className="grid gap-4">
        <input type="hidden" name="previous" value={saved} />
        <fieldset disabled={readOnly} className="grid gap-3">
          <legend className="sr-only">What to share</legend>
          {SHARING_LEVELS.map((l) => (
            <label key={l} className="flex items-start gap-3 rounded-control border border-line bg-surface px-4 py-3 has-[:checked]:border-accent">
              <input
                type="radio"
                name="level"
                value={l}
                checked={choice === l}
                onChange={() => setChoice(l)}
                aria-describedby={`${titleId}-${l}-hint`}
                className="mt-0.5 size-[18px] shrink-0 accent-accent"
              />
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  {SHARING_OPTIONS[l].label}
                  {l === DEFAULT_SHARING ? <Badge>Default</Badge> : null}
                </span>
                <span id={`${titleId}-${l}-hint`} className="text-sm text-fg-muted">
                  {SHARING_OPTIONS[l].description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {!readOnly && answered && notice ? <Alert tone={choice === "none" ? "warning" : "neutral"}>{notice}</Alert> : null}

        {!onboarding ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-fg">Exactly what is recorded when you share</summary>
            <div className="grid gap-2 pt-2">
              <TrackedList />
              <p className="text-fg-muted">{HOW_IT_HELPS}</p>
            </div>
          </details>
        ) : null}

        <p className="text-sm text-fg-muted">
          {NEVER_COLLECTED} {PERSON_CHOICE}{" "}
          <Link href="/privacy" className="underline">
            Read the privacy policy
          </Link>
          .
        </p>
        {changedLabel ? <p className="text-sm text-fg-muted">{changedLabel}</p> : null}
        {readOnly ? (
          <p className="text-sm text-fg-muted">Only the owner or an admin can change this.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton variant={onboarding ? "primary" : "secondary"} pendingLabel="Saving" disabled={!canSave}>
              Save choice
            </SubmitButton>
            {onboarding && skipHref ? (
              <Button asChild variant="ghost">
                <Link href={skipHref}>Skip for now</Link>
              </Button>
            ) : null}
          </div>
        )}
        {onboarding && !readOnly ? <p className="text-sm text-fg-muted">Skipping keeps Don&apos;t share anything. We ask again here until you choose.</p> : null}
      </form>
    </section>
  );
}
