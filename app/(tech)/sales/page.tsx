import { Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth/session";
import { COMMISSION_STATUS } from "@/lib/domain/commission";
import { formatCents } from "@/lib/domain/money";
import { addDays, todayIn } from "@/lib/domain/time";
import { commissionTotals, getSalesSettings, listCommissions, myTechnician } from "@/lib/server/sales";
import { formatInstant } from "@/lib/ui/format";

export const metadata: Metadata = { title: "My sales" };

// FR-SAL-04: a technician's own sales and where each commission stands.
export default async function MySalesPage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const member = await requireMember(["technician"]);
  const today = todayIn(member.timezone);
  const [settings, me] = await Promise.all([getSalesSettings(member), myTechnician(member)]);
  const { rows, timeZone } = me
    ? await listCommissions(member, { from: addDays(today, -179), to: today, technicianId: me.id, status: null })
    : { rows: [], timeZone: member.timezone };
  const totals = commissionTotals(rows);
  const added = (await searchParams).added === "1";

  return (
    <>
      <PageHeader
        title="My sales"
        description="The last 6 months."
        actions={
          settings.enabled ? (
            <Button asChild size="lg">
              <Link href="/sales/new">
                <Plus size={20} aria-hidden /> New customer
              </Link>
            </Button>
          ) : undefined
        }
      />
      {added ? <Alert tone="success">Customer added. Your commission is waiting for the office to approve it.</Alert> : null}
      <dl className="grid grid-cols-3 gap-2">
        {(["pending", "approved", "paid"] as const).map((s) => (
          <div key={s} className="grid gap-0.5 rounded-panel border border-line bg-surface p-3">
            <dt className="text-sm text-fg-muted">{COMMISSION_STATUS[s]!.label}</dt>
            <dd className="text-lg font-semibold tabular">{formatCents(totals[s].cents)}</dd>
          </div>
        ))}
      </dl>
      {rows.length === 0 ? (
        <EmptyState title="No sales yet">{settings.enabled ? "Customers you add from the field show up here with their commission." : "Your office has not turned on adding customers from the field."}</EmptyState>
      ) : (
        <ul className="grid gap-3" aria-label="Sales">
          {rows.map((r) => {
            const status = COMMISSION_STATUS[r.status]!;
            return (
              <li key={r.id} className="grid gap-1 rounded-panel border border-line bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{r.customerName}</span>
                  <span className="font-semibold tabular">{formatCents(r.amountCents)}</span>
                </div>
                <span className="text-sm text-fg-muted">
                  {formatInstant(r.createdAt, timeZone)}
                  {r.planName ? `, ${r.planName}` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {r.status === "void" && r.note ? <span className="text-sm text-fg-muted">{r.note}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
