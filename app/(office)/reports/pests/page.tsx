import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { pestActivity } from "@/lib/server/inventory";
import { formatLocalDate } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Pest activity by area" };

// FR-INV-10: target pests by ZIP code and week, from this business's own visits only.
export default async function PestActivityPage() {
  if (!isEnabled("reports") || !isEnabled("inventory")) notFound();
  const member = await requireMember(INVENTORY_ROLES);
  const { trends, weeks, today } = await pestActivity(member);

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Pest activity by area"
        description={`Target pests recorded on your completed visits, by ZIP code and week, for the last ${weeks} weeks. Only your own business's records are used. No other business's data is read or shared. Rising means the last 4 full weeks are up at least 50% on the 4 before.`}
        back={
          <Link href="/reports" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Reports
          </Link>
        }
      />
      {trends.length === 0 ? (
        <EmptyState title="No pests recorded yet">Pests appear here when technicians pick target pests on their applications. A visit counts once per pest.</EmptyState>
      ) : (
        <>
          <Table label="Pest activity by ZIP code">
            <THead>
              <tr>
                <TH>ZIP</TH>
                <TH>Pest</TH>
                <TH className="text-right">Last 4 weeks</TH>
                <TH className="text-right">The 4 before</TH>
                <TH>Trend</TH>
                <TH className="hidden md:table-cell">Visits per week</TH>
              </tr>
            </THead>
            <TBody>
              {trends.map((t) => {
                const max = Math.max(1, ...t.weekly);
                return (
                  <TR key={`${t.zip}|${t.pest}`}>
                    <TD className="tabular">{t.zip}</TD>
                    <TD className="font-medium">{t.pest}</TD>
                    <TD className="text-right tabular">{t.recent4}</TD>
                    <TD className="text-right tabular">{t.prior4}</TD>
                    <TD>{t.rising ? <Badge tone="warning">Rising</Badge> : <span className="text-fg-muted">Steady or lower</span>}</TD>
                    <TD className="hidden md:table-cell">
                      <span className="flex h-6 items-end gap-px" aria-hidden>
                        {t.weekly.map((n, i) => (
                          <span key={i} className="w-1.5 rounded-pill bg-accent" style={{ height: `${Math.max(n > 0 ? 12 : 4, (n / max) * 100)}%`, opacity: n > 0 ? 1 : 0.25 }} />
                        ))}
                      </span>
                      <span className="sr-only">{t.weekly.join(", ")} visits, oldest week first</span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <p className="text-sm text-fg-muted">The most recent bar is the current week so far. Through {formatLocalDate(today, "long")}.</p>
        </>
      )}
    </div>
  );
}
