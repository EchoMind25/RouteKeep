"use client";

import { CalendarDots, ChartBar, Gear, Package, Receipt, UsersThree, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// UX-01: five top-level areas; Inventory (FR-INV) joins them only for businesses that turned it on.
const ITEMS: { href: string; label: string; icon: Icon; flag?: "billing" | "reports" | "inventory" }[] = [
  { href: "/schedule", label: "Schedule", icon: CalendarDots },
  { href: "/customers", label: "Customers", icon: UsersThree },
  { href: "/billing", label: "Billing", icon: Receipt, flag: "billing" },
  { href: "/inventory", label: "Inventory", icon: Package, flag: "inventory" },
  { href: "/reports", label: "Reports", icon: ChartBar, flag: "reports" },
  { href: "/settings", label: "Settings", icon: Gear },
];

export function OfficeNav({ enabled }: { enabled: { billing: boolean; reports: boolean; inventory: boolean } }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.flag || enabled[i.flag]);
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto lg:grid lg:gap-0.5 lg:overflow-visible">
      {items.map(({ href, label, icon: IconCmp }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2.5 rounded-control px-3 font-medium text-fg-muted transition-colors",
              "hover:bg-sunken hover:text-fg",
              active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
            )}
          >
            <IconCmp size={18} weight={active ? "fill" : "regular"} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
