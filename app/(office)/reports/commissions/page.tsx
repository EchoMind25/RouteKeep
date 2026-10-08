import { ArrowLeft, DownloadSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form-status";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { COMMISSION_STATUS } from "@/lib/domain/commission";
import { formatCents } from "@/lib/domain/money";
import { instantToZoned, todayIn } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { commissionQuery, parseCommissionFilters } from "@/lib/reports/commissions";
import { listTechnicians } from "@/lib/server/catalog";
import { commissionTotals, listCommissions, type CommissionRow } from "@/lib/server/sales";
import { formatLocalDate, pluralize } from "@/lib/ui/format";
import { decideCommissionAction } from "./actions";

export const metadata: Metadata = { title: "Commissions" };

const DONE: Record<string, { tone: "success" | "warning"; text: string }> = {
  approved: { tone: "success", text: "Approved." },
  paid: { tone: "success", text: "Marked paid." },
  pending: { tone: "success", text: "Back to waiting for approval." },
  void: { tone: "success", text: "Voided. It stays on file with the reason." },
  reason: { tone: "warning", text: "Say why before voiding a commission." },
  changed: { tone: "warning", text: "Someone else changed that commission. The list shows where it stands now." },
  unreadable: { tone: "warning", text: "That change could not be read. Try again." },
};

/** What the office can do next with a commission (FR-SAL-03). */
function Decisions({ row, back }: { row: CommissionRow; back: string }) {
  const hidden = (
    <>
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="version" value={row.version} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  if (row.status === "paid" || row.status === "void") return row.note ? <span className="text-sm text-fg-muted">{row.note}</span> : null;
  return (
    <div className="grid gap-2">
      <form action={decideCommissionAction} className="flex flex-wrap gap-2">
        {hidden}
        {row.status === "pending" ? (
          <SubmitButton name="status" value="approved" size="sm" pendingLabel="Saving">
            Approve
          </SubmitButton>
        ) : (
          <>
            <SubmitButton name="status" value="paid" size="sm" pendingLabel="Saving">
              Mark paid
            </SubmitButton>
            <SubmitButton name="status" value="pending" size="sm" variant="ghost" pendingLabel="Saving">
              Undo approval
            </SubmitButton>
          </>
        )}
      </form>
      <form action={decideCommissionAction} className="flex flex-wrap items-center gap-2">
        {hidden}
        <label htmlFor={`void-${row.id}`} className="sr-only">
          Reason to void the commission for {row.customerName}
        </label>
        <Input id={`void-${row.id}`} name="note" placeholder="Reason to void" className="h-9 w-44" maxLength={500} />
        <SubmitButton name="status" value="void" size="sm" variant="secondary" pendingLabel="Saving">
          Void
        </SubmitButton>
      </form>
    </div>
  );
}

// FR-SAL-04: commissions by date of sale, technician and status, with CSV for payroll.
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; technician?: string; status?: string; done?: string }> }) {
  if (!isEnabled("reports")) notFound();
  const member = await requireMember(OFFICE_ROLES);
  const params = await searchParams;
  const { filters, problem } = parseCommissionFilters(params, todayIn(member.timezone));
  const [{ rows, timeZone, truncated }, technicians] = await Promise.all([listCommissions(member, filters), listTechnicians(member)]);
  const totals = commissionTotals(rows);
  const back = `/reports/commissions?${commissionQuery(filters)}`;
  const done = DONE[params.done ?? ""];
  const canDecide = member.role !== "dispatcher";

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Commissions"
        description="Earned by technicians on the customers they added. Amounts are fixed at the sale."
        back={
          <Link href="/reports" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Reports
          </Link>
        }
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/reports/commissions?${commissionQuery(filters)}`} download>
              <DownloadSimple size={18} aria-hidden /> CSV
            </a>
          </Button>
        }
      />
      <form action="/reports/commissions" className="grid gap-3 pb-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" aria-label="Report filters">
        <Field label="Sold from" className="lg:w-44">
          <Input type="date" name="from" defaultValue={filters.from} required />
        </Field>
        <Field label="Sold to" className="lg:w-44">
          <Input type="date" name="to" defaultValue={filters.to} required />
        </Field>
        <Field label="Technician" className="lg:w-56">
          <Select name="technician" defaultValue={filters.technicianId ?? ""}>
            <option value="">All technicians</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.display_name}
                {t.active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" className="lg:w-56">
          <Select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any status</option>
            {Object.entries(COMMISSION_STATUS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Loading">
          Show
        </SubmitButton>
      </form>
      {problem ? <Alert tone="warning">{problem}</Alert> : null}
      {done ? <Alert tone={done.tone}>{done.text}</Alert> : null}

      {rows.length === 0 ? (
        <EmptyState title="No sales in this range">
          Technicians add customers from their app once it is turned on in <Link href="/settings/sales" className="font-medium text-accent hover:underline">Settings, Sales</Link>.
        </EmptyState>
      ) : (
        <>
          <dl className="grid gap-3 pb-2 sm:grid-cols-4">
            {(["pending", "approved", "paid", "void"] as const).map((s) => (
              <div key={s} className="grid gap-0.5 rounded-panel border border-line bg-surface p-4">
                <dt className="text-sm text-fg-muted">{COMMISSION_STATUS[s]!.label}</dt>
                <dd className="text-lg font-semibold tabular">{formatCents(totals[s].cents)}</dd>
                <dd className="text-sm text-fg-muted">{pluralize(totals[s].count, "sale")}</dd>
              </div>
            ))}
          </dl>
          {truncated ? <p className="text-sm text-fg-muted">Showing the newest 1,000. The CSV has every one.</p> : null}
          <Table label="Commissions">
            <THead>
              <tr>
                <TH>Sold</TH>
                <TH>Technician</TH>
                <TH>Customer</TH>
                <TH className="text-right">Commission</TH>
                <TH>Status</TH>
                {canDecide ? <TH>Decision</TH> : null}
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const status = COMMISSION_STATUS[r.status]!;
                return (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap tabular">{formatLocalDate(instantToZoned(r.createdAt, timeZone).date)}</TD>
                    <TD>{r.technicianName}</TD>
                    <TD>
                      <Link href={`/customers/${r.customerId}`} className="font-medium hover:underline">
                        {r.customerName}
                      </Link>
                      {r.planName ? <span className="block text-sm text-fg-muted">{r.planName}</span> : null}
                    </TD>
                    <TD className="text-right tabular">
                      <span className="font-semibold">{formatCents(r.amountCents)}</span>
                      <span className="block text-sm text-fg-muted">
                        {[r.flatCents ? `${formatCents(r.flatCents)} flat` : null, r.pct ? `${r.pct}% of ${formatCents(r.basisCents)}` : null].filter(Boolean).join(" + ") || "No rule set"}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </TD>
                    {canDecide ? (
                      <TD>
                        <Decisions row={r} back={back} />
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
