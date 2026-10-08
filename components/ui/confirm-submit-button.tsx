"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * A submit button for an action that is hard to take back, usable inside a
 * server-component form. The first press changes the label to ask again; a
 * second press within a few seconds submits. NFR accessibility: no accidental
 * activation, and the change is announced.
 */
export function ConfirmSubmitButton({ children, confirmLabel, pendingLabel, onClick, ...props }: ButtonProps & { confirmLabel: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <>
      <Button
        type="submit"
        loading={pending}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          if (armed || event.defaultPrevented) return;
          event.preventDefault();
          setArmed(true);
        }}
      >
        {pending && pendingLabel ? pendingLabel : armed ? confirmLabel : children}
      </Button>
      <span role="status" className="sr-only">
        {armed ? "Press again to confirm." : ""}
      </span>
    </>
  );
}
