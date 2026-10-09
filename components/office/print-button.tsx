"use client";

import { Printer } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

// FR-INV-05: print the order from the browser; the sidebar and tabs are hidden in print.
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      <Printer size={18} aria-hidden /> Print
    </Button>
  );
}
