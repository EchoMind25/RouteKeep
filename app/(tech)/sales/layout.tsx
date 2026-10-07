import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";

// FR-SAL-02: technician sales are online pages beside the offline app, kept to
// one column and thumb-sized controls (FR-TEC-11).
export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-dvh max-w-2xl content-start gap-4 px-4 pt-4 pb-12">
      <header className="flex items-center justify-between gap-3">
        <Link href="/tech" className="inline-flex min-h-12 items-center gap-2 font-medium text-fg-muted hover:text-fg">
          <ArrowLeft size={20} aria-hidden /> My route
        </Link>
        <BrandMark />
      </header>
      {children}
    </div>
  );
}
