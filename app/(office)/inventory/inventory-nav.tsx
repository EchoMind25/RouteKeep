"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/inventory", label: "Overview", exact: true },
  { href: "/inventory/resupply", label: "Resupply" },
  { href: "/inventory/orders", label: "Orders" },
  { href: "/inventory/vendors", label: "Vendors" },
  { href: "/inventory/stock", label: "Stock", tracked: true },
  { href: "/inventory/spend", label: "Spend" },
];

export function InventoryNav({ tracked }: { tracked: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Inventory sections" className="flex gap-1 overflow-x-auto border-b border-line print:hidden">
      {TABS.filter((t) => !t.tracked || tracked).map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 font-medium transition-colors",
              active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
