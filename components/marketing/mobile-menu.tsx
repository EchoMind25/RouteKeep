"use client";

import { useRef } from "react";

// The header's small-screen menu. It is a plain <details>, so it opens with no
// script; this only closes it again on Escape (focus back on the button) or
// once a link inside is followed, because the header stays mounted across
// page changes.
export function MobileMenu({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      className={className}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !ref.current?.open) return;
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }}
    >
      {children}
    </details>
  );
}
