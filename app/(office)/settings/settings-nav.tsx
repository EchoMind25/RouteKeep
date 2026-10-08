"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/settings", label: "Business" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/technicians", label: "Technicians" },
  { href: "/settings/plans", label: "Plans" },
  { href: "/settings/products", label: "Products" },
  { href: "/settings/sales", label: "Sales" },
  { href: "/settings/messages", label: "Messages" },
  { href: "/settings/import", label: "Import" },
  { href: "/settings/export", label: "Export" },
  { href: "/settings/changes", label: "What's new" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = t.href === "/settings" ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
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
