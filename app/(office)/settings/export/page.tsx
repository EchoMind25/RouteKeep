import { DownloadSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ADMIN_ROLES, requireMember } from "@/lib/auth/session";
import { listExports } from "@/lib/server/exports";
import { formatInstant } from "@/lib/ui/format";
import { ExportPanel } from "./export-panel";

export const metadata: Metadata = { title: "Export" };

const sizeText = (bytes: number | null) => (bytes === null ? "" : bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// FR-EXP-01..03: everything the business has here, in one file, any time.
// Not behind a flag: being able to leave is a promise from day one.
export default async function ExportPage() {
  const member = await requireMember(ADMIN_ROLES);
  const exports = await listExports(member);
  const now = new Date();
  const unfinished = exports.find((e) => e.status === "queued" || e.status === "running");
  return (
    <div className="grid gap-10">
      <section aria-labelledby="export-title" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="export-title" className="text-md font-semibold">
            Export everything
          </h2>
          <p className="max-w-[70ch] text-fg-muted">
            One ZIP file with every table as CSV and JSON, your customer list ready to import anywhere (including here), every pesticide application record as a PDF per month, and all photos, signatures and documents. The download link works for 7 days.
          </p>
        </div>
        <ExportPanel resumeId={unfinished?.id ?? null} />
      </section>
      <section aria-labelledby="past-exports" className="grid gap-3">
        <h2 id="past-exports" className="text-md font-semibold">
          Exports
        </h2>
        {exports.length === 0 ? (
          <EmptyState title="No exports yet">Your first export takes a minute or two for a typical business.</EmptyState>
        ) : (
          <Table label="Exports">
            <THead>
              <tr>
                <TH>Started</TH>
                <TH>Status</TH>
                <TH>Size</TH>
                <TH>
                  <span className="sr-only">Download</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {exports.map((e) => {
                const live = e.status === "ready" && e.expires_at && e.expires_at > now;
                return (
                  <TR key={e.id}>
                    <TD className="tabular">{formatInstant(e.created_at, member.timezone)}</TD>
                    <TD>
                      {live ? (
                        <Badge tone="success">Ready until {formatInstant(e.expires_at!, member.timezone)}</Badge>
                      ) : e.status === "ready" ? (
                        <Badge>Link expired</Badge>
                      ) : e.status === "failed" ? (
                        <Badge tone="danger">Stopped</Badge>
                      ) : (
                        <Badge tone="warning">Not finished</Badge>
                      )}
                    </TD>
                    <TD className="tabular">{sizeText(e.size_bytes === null ? null : Number(e.size_bytes))}</TD>
                    <TD className="text-right">
                      {live ? (
                        <a href={`/api/exports/${e.id}`} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                          <DownloadSimple size={16} aria-hidden /> Download
                        </a>
                      ) : null}
                    </TD>
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
