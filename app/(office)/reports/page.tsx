import { Bug, CaretRight, ChartLineUp, Flask, HandCoins, Package } from "@phosphor-icons/react/ssr";
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
        {isEnabled("billing") ? (
          <li>
            <Link href="/reports/billing" className="flex items-center gap-4 rounded-panel border border-line bg-surface p-5 hover:border-line-strong">
              <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent" aria-hidden>
                <ChartLineUp size={22} />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-semibold">Money</span>
                <span className="text-sm text-fg-muted">Revenue by month, money owed by how late it is, and production by technician.</span>
              </span>
              <CaretRight size={18} aria-hidden className="shrink-0 text-fg-muted" />
            </Link>
          </li>
        ) : null}
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
        {isEnabled("inventory") ? (
          <>
            <li>
              <Link href="/reports/pests" className="flex items-center gap-4 rounded-panel border border-line bg-surface p-5 hover:border-line-strong">
                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent" aria-hidden>
                  <Bug size={22} />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-semibold">Pest activity by area</span>
                  <span className="text-sm text-fg-muted">Target pests by ZIP code and week, with rising areas flagged. Your own business&apos;s visits only.</span>
                </span>
                <CaretRight size={18} aria-hidden className="shrink-0 text-fg-muted" />
              </Link>
            </li>
            <li>
              <Link href="/inventory" className="flex items-center gap-4 rounded-panel border border-line bg-surface p-5 hover:border-line-strong">
                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent" aria-hidden>
                  <Package size={22} />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-semibold">Usage forecast</span>
                  <span className="text-sm text-fg-muted">How much product the schedule will use this week, the next three weeks and the rest of the month, and what to order.</span>
                </span>
                <CaretRight size={18} aria-hidden className="shrink-0 text-fg-muted" />
              </Link>
            </li>
          </>
        ) : null}
      </ul>
    </div>
  );
}
