"use client";

import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const control = [
  "w-full rounded-control border border-line-strong bg-surface text-fg",
  "placeholder:text-fg-muted",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-muted",
  "aria-invalid:border-danger aria-invalid:outline-danger",
];

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10 px-3 md:h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 px-3 py-2", className)} {...props} />;
}

export function Select({ className, children, ref, ...props }: ComponentProps<"select">) {
  const own = useRef<HTMLSelectElement | null>(null);
  const { defaultValue, value } = props;
  // Compared as text, so an array default does not count as new on every render.
  const wantedKey = defaultValue === undefined ? undefined : (Array.isArray(defaultValue) ? defaultValue : [defaultValue]).map(String).join("\u0000");
  // React applies a select's defaultValue only when it mounts, unlike inputs.
  // After a failed server action the form is reset to its defaults, which are
  // now the submitted values (lib/forms.ts); without this the choice made
  // before submitting would silently snap back to the original one.
  useLayoutEffect(() => {
    const select = own.current;
    if (!select || value !== undefined || wantedKey === undefined) return;
    const wanted = wantedKey.split("\u0000");
    for (const option of select.options) option.defaultSelected = wanted.includes(option.value);
    if (!select.multiple) select.value = wanted[0] ?? "";
  }, [wantedKey, value]);
  return (
    <select
      ref={(node) => {
        own.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn(control, "h-10 px-2.5 md:h-9", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Checkbox({ className, label, hint, ...props }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  // Unique per instance: two forms on one page often share field names.
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className={cn("mt-0.5 size-[18px] shrink-0 accent-accent", className)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="font-medium text-fg">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-sm text-fg-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface FieldProps {
  label: ReactNode;
  /** Shown under the label; stays in the markup for screen readers. */
  hint?: ReactNode;
  error?: string | string[] | null;
  optional?: boolean;
  className?: string;
  /** One control; the label, hint and error are wired to it. */
  children: ReactElement<{ id?: string; name?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}

/** Label above, hint under the label, error under the control (taste 4.6). */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const autoId = useId();
  const id = children.props.id ?? autoId;
  const message = Array.isArray(error) ? error[0] : error;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = message ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="font-medium text-fg">
        {label}
        {optional ? (
          <>
            {" "}
            <span className="ml-1 font-normal text-fg-muted">(optional)</span>
          </>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="-mt-1 text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      {isValidElement(children)
        ? cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": message ? true : undefined })
        : children}
      {message ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function Fieldset({ legend, description, children, className }: { legend: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("grid gap-4", className)}>
      <div className="grid gap-1">
        <legend className="text-md font-semibold text-fg">{legend}</legend>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}
