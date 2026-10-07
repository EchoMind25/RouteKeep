import { ArrowLeft, DownloadSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Alert, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { isEnabled } from "@/lib/flags";
import { getImport } from "@/lib/server/imports";
import { formatInstant, pluralize } from "@/lib/ui/format";
import { CommitPanel, MappingForm, RollbackButton } from "../import-forms";
import { IMPORT_STATUS, SOURCE_LABEL } from "../status";

export const metadata: Metadata = { title: "Import" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PRD 9.3: match, check, dry run, import, reconcile, undo. One page, in order.
export default async function ImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled("migration")) notFound();
  const member = await requireMember(ADMIN_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getImport(member, id);
  if (!data) notFound();
  const { job, counts, problems } = data;
  const files = job.files as { name: string; rows: number }[];
  const status = IMPORT_STATUS[job.status] ?? { label: job.status, tone: "neutral" as const };
  const editable = ["uploaded", "mapped", "validated"].includes(job.status);
  const dry = job.dryRun;
  const toImport = (counts.valid ?? 0) + (counts.committed ?? 0);
  const finished = ["committed", "reconciled", "rolled_back"].includes(job.status);
  const rollback = (job.stats as { rollback?: { removed: number; kept: number } }).rollback ?? null;
  const canUndo = (job.status === "committed" || job.status === "reconciled") && job.rollback_deadline && job.rollback_deadline > new Date() && !rollback;

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Link href="/settings/import" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft size={14} aria-hidden /> Imports
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{files[0]?.name ?? "Import"}</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-fg-muted">
          {pluralize(job.stats.rows, "row")} from {SOURCE_LABEL[job.source] ?? job.source}
          {job.stats.presetName ? `, columns matched from "${job.stats.presetName}"` : ""}. Uploaded {formatInstant(job.created_at, member.timezone)}.
        </p>
      </div>

      <Panel title="1. Match columns" description="Each field on the left takes its value from the column you pick. Examples come from the first rows of your file.">
        <div className="px-5 py-4">
          <MappingForm id={job.id} headers={job.stats.headers} map={job.stats.columnMap} sample={job.stats.sample} readOnly={!editable} />
        </div>
      </Panel>

      {dry ? (
        <Panel title="2. What will happen" description="Nothing has been added yet.">
          <div className="grid gap-5 px-5 py-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["New customers", dry.create],
                ["Updated", dry.update],
                ["Already here, unchanged", dry.unchanged],
                ["Need fixing", dry.invalid],
                ["Duplicates skipped", dry.duplicate],
                ["Active plans", dry.subscriptions],
                ["Monthly plan revenue", formatCents(dry.monthlyCents)],
                ["Open balances", formatCents(dry.openCents)],
              ].map(([label, value]) => (
                <div key={String(label)} className="grid gap-0.5 rounded-control bg-sunken p-3">
                  <dt className="text-sm text-fg-muted">{label}</dt>
                  <dd className="text-lg font-semibold tabular">{value}</dd>
                </div>
              ))}
            </dl>
            {dry.warnings ? <p className="text-sm text-fg-muted">{pluralize(dry.warnings, "phone or email")} could not be read and will be left blank. The customers are still imported.</p> : null}
            {problems.length ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">Rows that will not be imported</h3>
                  {counts.invalid ? (
                    <a href={`/api/imports/${job.id}/problems`} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                      <DownloadSimple size={16} aria-hidden /> Download the rows to fix ({counts.invalid})
                    </a>
                  ) : null}
                </div>
                <Table label="Rows that will not be imported">
                  <THead>
                    <tr>
                      <TH>Row</TH>
                      <TH>Why</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {problems.map((p) => (
                      <TR key={p.row_number}>
                        <TD className="tabular">{p.row_number + 1}</TD>
                        <TD>{p.reasons.join("; ")}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <p className="text-sm text-fg-muted">Fix them in the downloaded file and upload it as a new import. Customers already imported are recognised and not added twice.</p>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {dry && !finished && toImport > 0 ? (
        <Panel title="3. Import" description="Adds the customers above in small batches. If the page closes, press Import again: nothing is added twice.">
          <div className="px-5 py-4">
            <CommitPanel id={job.id} toImport={toImport} started={job.status === "committing"} />
          </div>
        </Panel>
      ) : null}

      {job.reconcile ? (
        <Panel title="Check the totals" description="What your file said, beside what is now in the app.">
          <div className="grid gap-4 px-5 py-4">
            <Alert tone={job.reconcile.matches ? "success" : "warning"}>
              {job.reconcile.matches ? "Everything in the file is here." : "Some totals differ. The rows below show where."}
            </Alert>
            <Table label="Totals">
              <THead>
                <tr>
                  <TH> </TH>
                  <TH className="text-right">In the file</TH>
                  <TH className="text-right">Imported</TH>
                </tr>
              </THead>
              <TBody>
                {job.reconcile.rows.map((r) => (
                  <TR key={r.label}>
                    <TD>{r.label}</TD>
                    <TD className="text-right tabular">{r.money ? formatCents(r.file) : r.file}</TD>
                    <TD className="text-right tabular">{r.money ? formatCents(r.imported) : r.imported}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="text-sm text-fg-muted">Addresses were placed on the map where they could be found. Check pins from the schedule before the first route.</p>
          </div>
        </Panel>
      ) : null}

      {canUndo ? (
        <Panel title="Undo" description={`Until ${formatInstant(job.rollback_deadline!, member.timezone)}. Customers you have already worked with are kept.`}>
          <div className="px-5 py-4">
            <RollbackButton id={job.id} />
          </div>
        </Panel>
      ) : null}
      {rollback ? (
        <Alert tone={rollback.kept ? "warning" : "success"}>
          Import undone. {pluralize(rollback.removed, "customer")} removed with their addresses, plans and visits.
          {rollback.kept ? ` ${pluralize(rollback.kept, "customer")} kept because you had already worked with them.` : ""}
        </Alert>
      ) : null}
    </div>
  );
}
