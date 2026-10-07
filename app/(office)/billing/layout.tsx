import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isEnabled } from "@/lib/flags";
import { BillingNav } from "./billing-nav";

export default function BillingLayout({ children }: { children: ReactNode }) {
  if (!isEnabled("billing")) notFound();
  return (
    <div className="grid gap-4">
      <BillingNav />
      {children}
    </div>
  );
}
