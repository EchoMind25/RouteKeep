"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * After a failed useActionState submit, move focus to the first field marked
 * aria-invalid (Field sets it when it shows an error). Pass the action state
 * and put the returned ref on the form. NFR accessibility: keyboard and screen
 * reader users land on the problem instead of at the top of the page.
 */
export function useFocusFirstInvalid(state: unknown) {
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return form;
}

/** A submit button that shows the form is working and blocks double submits. */
export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
