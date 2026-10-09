"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useFocusFirstInvalid } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { initialFormState, type FormState } from "@/lib/forms";

/**
 * A form for a server action that returns a FormState, usable from a server
 * component. Shows the action's message above the fields; after a failure the
 * fields are filled back with what was submitted, because React resets the form.
 */
export function ActionForm({
  action,
  className,
  children,
  successMessage = true,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  className?: string;
  children: ReactNode;
  successMessage?: boolean;
}) {
  const [state, run] = useActionState(action, initialFormState);
  const ref = useFocusFirstInvalid(state);
  useEffect(() => {
    const form = ref.current;
    const values = state.values;
    if (!form || state.ok || !values) return;
    for (const el of Array.from(form.elements)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name) continue;
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;
      if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = values[el.name] === "on" || values[el.name] === "true";
      else if (el.name in values) el.value = values[el.name]!;
    }
  }, [state, ref]);
  return (
    <form ref={ref} action={run} className={cn("grid gap-4", className)} noValidate>
      {state.message && (!state.ok || successMessage) ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      {children}
    </form>
  );
}
