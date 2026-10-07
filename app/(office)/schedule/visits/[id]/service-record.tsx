import { FilePdf, PencilSimple } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Details, Panel } from "@/components/ui/layout";
import { amountLabel, areaLabel, formatNumber, isAmountUnit, isAreaUnit, isMixUnit, mixLabel } from "@/lib/domain/units";
import type { RecordVersion, ServiceRecord } from "@/lib/server/records";
import { formatInstant, SIGNAL_WORD } from "@/lib/ui/format";

// FR-REC-01, CR-01, CR-02: what the technician recorded, as the office sees it.

function quantity(value: number | null, unit: string | null, label: (u: never) => string, guard: (u: string) => boolean) {
  if (value === null || !unit || !guard(unit)) return "";
  return `${formatNumber(value)} ${label(unit as never)}`;
}

/** The CR-01 fields of one version of a record. */
function versionDetails(a: RecordVersion & { timing?: ServiceRecord["applications"][number]["timing"] }, tz: string) {
  return [
    { label: "Mix rate", value: quantity(a.mixRate, a.mixUnit, mixLabel, isMixUnit) },
    { label: "Total applied", value: quantity(a.totalAmount, a.amountUnit, amountLabel, isAmountUnit) },
    { label: "Area treated", value: quantity(a.areaTreated, a.areaUnit, areaLabel, isAreaUnit) },
    { label: "Target sites", value: a.targetSites.join(", ") },
    { label: "Target pests", value: a.targetPests.join(", ") },
    { label: "Applied", value: formatInstant(a.appliedAt, tz) },
    ...(a.timing
      ? [{ label: "Recorded", value: `${formatInstant(a.timing.madeAt, tz)} (${a.timing.late ? `${Math.round(a.timing.hoursAfter)} h after the application` : "on time"})` }]
      : []),
    { label: "Applicator", value: `${a.applicatorName ?? ""}${a.applicatorLicenseNo ? `, license ${a.applicatorLicenseNo}` : ""}` },
    ...(a.customerStatementAt ? [{ label: "Customer statement", value: `Given ${formatInstant(a.customerStatementAt, tz)}` }] : []),
  ];
}

export function ServiceRecordPanel({ record, canAmend = false }: { record: ServiceRecord; canAmend?: boolean }) {
  const { visit, applications, attachments } = record;
  const tz = visit.timeZone;
  const photos = attachments.filter((a) => a.kind === "photo");
  const signature = attachments.find((a) => a.kind === "signature");
  return (
    <Panel
      title="Service record"
      description={visit.completedAt ? `Completed ${formatInstant(visit.completedAt, tz)}` : undefined}
      actions={
        visit.status === "completed" ? (
          <Button asChild variant="secondary" size="sm">
            <a href={`/api/records/${visit.id}`} target="_blank" rel="noreferrer">
              <FilePdf size={16} aria-hidden /> PDF for the customer
            </a>
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-5 px-5 py-4">
        {visit.recordDue ? (
          // CR-02: started on a phone, not finished. The phone may hold a finished record that has not uploaded yet.
          <Alert
            tone={visit.recordDue.overdue ? "danger" : visit.recordDue.warn ? "warning" : "neutral"}
            title={`${visit.recordDue.overdue ? "Record overdue since" : "Record due by"} ${formatInstant(visit.recordDue.due, tz)}`}
          >
            Records are due within 24 hours of the application. Nothing has reached the office for this visit yet.
          </Alert>
        ) : null}
        <Details
          items={[
            ...(visit.arrivedAt ? [{ label: "Arrived", value: formatInstant(visit.arrivedAt, tz) }] : []),
            ...(visit.checklist.length ? [{ label: "Checklist", value: `${visit.checklist.filter((c) => c.done).length} of ${visit.checklist.length} done` }] : []),
            ...(visit.techNotes ? [{ label: "Technician notes", value: <span className="whitespace-pre-line">{visit.techNotes}</span> }] : []),
            ...(visit.signerName ? [{ label: "Signed by", value: visit.signerName }] : []),
          ]}
        />

        {applications.length === 0 ? (
          <p className="text-fg-muted">{visit.status === "in_progress" ? "No products have reached the office yet." : "No products recorded for this visit."}</p>
        ) : (
          <ul className="grid gap-4" aria-label="Products applied">
            {applications.map((a) => (
              <li key={a.id}>
                <section aria-label={a.productName} className="grid gap-2 rounded-control border border-line p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{a.productName}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {a.epaRegNo ? <Badge>EPA {a.epaRegNo}</Badge> : null}
                      {a.signalWord ? <Badge>{SIGNAL_WORD[a.signalWord] ?? a.signalWord}</Badge> : null}
                      {a.restrictedUse ? <Badge tone="warning">Restricted use</Badge> : null}
                      {a.history.length ? <Badge>Amended</Badge> : null}
                      {/* CR-02: a record must be made within 24 hours of the application. */}
                      {a.timing?.late ? <Badge tone="danger">Recorded {Math.round(a.timing.hoursAfter)} h after application</Badge> : null}
                    </div>
                  </div>
                  <Details items={versionDetails(a, tz)} />
                  {a.history.length ? (
                    <p className="text-sm text-fg-muted">
                      Amended {formatInstant(a.recordedAt, tz)}: {a.amendmentReason}
                    </p>
                  ) : null}
                  {canAmend ? (
                    <div className="pt-1">
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/schedule/visits/${visit.id}/records/${a.id}/amend`} aria-label={`Amend the ${a.productName} record`}>
                          <PencilSimple size={16} aria-hidden /> Amend
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                  {a.history.length ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
                        {a.history.length === 1 ? "Earlier version" : `${a.history.length} earlier versions`}
                      </summary>
                      <ol className="mt-3 grid gap-3">
                        {a.history.map((h) => (
                          <li key={h.id} className="grid gap-2 rounded-control bg-sunken p-3">
                            <div>
                              <p className="font-medium">{h.amendmentReason ? `Amended ${formatInstant(h.recordedAt, tz)}` : `Original, recorded ${formatInstant(h.recordedAt, tz)}`}</p>
                              {h.amendmentReason ? <p className="text-fg-muted">{h.amendmentReason}</p> : null}
                            </div>
                            <Details items={[{ label: "Product", value: `${h.productName}${h.epaRegNo ? `, EPA ${h.epaRegNo}` : ""}` }, ...versionDetails(h, tz)]} />
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </section>
              </li>
            ))}
          </ul>
        )}

        {photos.length || signature ? (
          <div className="grid gap-3">
            {photos.length ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Photos">
                {photos.map((p, i) => (
                  <li key={p.id}>
                    <a href={`/api/attachments/${p.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-control border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in file; next/image cannot fetch it */}
                      <img src={`/api/attachments/${p.id}`} alt={`Photo ${i + 1}${p.capturedAt ? `, ${formatInstant(p.capturedAt, tz)}` : ""}`} className="aspect-square w-full object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {signature ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, signed-in file; next/image cannot fetch it
              <img src={`/api/attachments/${signature.id}`} alt={`Signature${visit.signerName ? ` of ${visit.signerName}` : ""}`} className="h-28 max-w-xs rounded-control border border-line bg-surface object-contain" />
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
