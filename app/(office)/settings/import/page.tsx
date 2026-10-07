import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { listImports } from "@/lib/server/imports";
import { formatInstant } from "@/lib/ui/format";
import { UploadForm } from "./import-forms";
import { IMPORT_STATUS, SOURCE_LABEL } from "./status";

export const metadata: Metadata = { title: "Import customers" };

// PRD section 9: bring a customer list over from other software.
export default async function ImportPage() {
  if (!isEnabled("migration")) notFound();
  const member = await requireMember(ADMIN_ROLES);
  const jobs = await listImports(member);
  return (
    <div className="grid gap-10">
      <section aria-labelledby="new-import" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="new-import" className="text-md font-semibold">
            Import customers
          </h2>
          <p className="max-w-[70ch] text-fg-muted">
            Customers, service addresses, plans, next service dates and open balances, from any spreadsheet or export. You check the column matches and every row before anything is added, and you can undo an import for 7 days.
          </p>
        </div>
        <UploadForm />
      </section>
      <section aria-labelledby="past-imports" className="grid gap-3">
        <h2 id="past-imports" className="text-md font-semibold">
          Imports
        </h2>
        {jobs.length === 0 ? (
          <EmptyState title="No imports yet">Upload a file above to start.</EmptyState>
        ) : (
          <Table label="Imports">
            <THead>
              <tr>
                <TH>File</TH>
                <TH>From</TH>
                <TH>Status</TH>
                <TH>Started</TH>
              </tr>
            </THead>
            <TBody>
              {jobs.map((j) => {
                const files = j.files as { name: string; rows: number }[];
                const status = IMPORT_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
                return (
                  <TR key={j.id}>
                    <TD>
                      <Link href={`/settings/import/${j.id}`} className="font-medium hover:underline">
                        {files[0]?.name ?? "File"}
                      </Link>
                      <span className="block text-sm text-fg-muted">{files[0]?.rows ?? 0} rows</span>
                    </TD>
                    <TD>{SOURCE_LABEL[j.source] ?? j.source}</TD>
                    <TD>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </TD>
                    <TD className="tabular">{formatInstant(j.created_at, member.timezone)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
