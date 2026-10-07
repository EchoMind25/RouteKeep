import { CaretRight, Flask, HandCoins } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";

export const metadata: Metadata = { title: "Reports" };

// S13 (UX-01): every report reads the records as they were saved, and downloads as CSV or PDF.
export default async function ReportsPage() {
  if (!isEnabled("reports")) notFound();
  await requireMember(OFFICE_ROLES);
  return (
    <div className="grid gap-2">
      <PageHeader title="Reports" description="Read from the records as they were saved. Each one downloads as CSV or PDF." />
      <ul className="grid max-w-3xl gap-3">
        <li>
          <Link href="/reports/products" className="flex items-center gap-4 rounded-panel border border-line bg-surface p-5 hover:border-line-strong">
            <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent" aria-hidden>
              <Flask size={22} />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-semibold">Product usage</span>
              <span className="text-sm text-fg-muted">What was applied, how much and where, by date range, product, EPA number and technician.</span>
            </span>
            <CaretRight size={18} aria-hidden className="shrink-0 text-fg-muted" />
          </Link>
        </li>
        <li>
          <Link href="/reports/commissions" className="flex items-center gap-4 rounded-panel border border-line bg-surface p-5 hover:border-line-strong">
            <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent" aria-hidden>
              <HandCoins size={22} />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-semibold">Commissions</span>
              <span className="text-sm text-fg-muted">Customers technicians added, what each sale earned, and what has been approved and paid.</span>
            </span>
            <CaretRight size={18} aria-hidden className="shrink-0 text-fg-muted" />
          </Link>
        </li>
      </ul>
      {isEnabled("billing") ? null : <p className="pt-2 text-sm text-fg-muted">Revenue, money owed and production by technician arrive with billing.</p>}
    </div>
  );
}
