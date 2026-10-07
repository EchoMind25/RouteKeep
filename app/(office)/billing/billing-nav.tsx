"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/billing", label: "Invoices" },
  { href: "/billing/collections", label: "Collections" },
];

export function BillingNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Billing sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = t.href === "/billing" ? pathname === "/billing" || pathname.startsWith("/billing/invoices") : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2.5 font-medium transition-colors", active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
