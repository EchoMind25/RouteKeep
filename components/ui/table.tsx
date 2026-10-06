import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// Dense office table: one hairline between rows, header on a sunken band.

/**
 * `label` names the table for screen readers and makes the scroll container a
 * keyboard-reachable region when the table is wider than the screen (WCAG 2.1.1).
 */
export function Table({ className, label, ...props }: ComponentProps<"table"> & { label: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-panel border border-line bg-surface focus-visible:outline-offset-0">
      <table className={cn("w-full border-collapse text-left", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-sunken text-sm text-fg-muted", className)} {...props} />;
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cn("px-4 py-2.5 font-medium whitespace-nowrap", className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-canvas", className)} {...props} />;
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-top", className)} {...props} />;
}
