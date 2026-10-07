import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Alert, Details, Panel, PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { listTechnicians } from "@/lib/server/catalog";
import { getServiceRecord } from "@/lib/server/records";
import { getVisit } from "@/lib/server/visits";
import { APPOINTMENT_STATUS, formatLocalDate, formatWindow } from "@/lib/ui/format";
import { ServiceRecordPanel } from "./service-record";
import { ReasonForm, RescheduleForm, RestoreForm } from "./visit-forms";

export const metadata: Metadata = { title: "Visit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// S10 / FR-SUB-03 "this visit only", FR-DSP-02.
const DONE: Record<string, string> = {
  updated: "Visit updated. It keeps this date and person even if the plan changes.",
  skipped: "Visit skipped. It stays in the needs-attention list until someone deals with it.",
  cancelled: "Visit cancelled. Nothing is charged; you can restore it below.",
  restored: "Visit restored.",
  amended: "Amendment saved. The record shows the corrected version; the earlier one stays on file.",
};

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id } = await params;
  const done = DONE[(await searchParams).done ?? ""];
  if (!UUID.test(id)) notFound();
  const [visit, technicians, record] = await Promise.all([getVisit(member, id), listTechnicians(member, { activeOnly: true }), getServiceRecord(member, id)]);
  if (!visit || !record) notFound();
  const worked = record.applications.length > 0 || record.attachments.length > 0 || Boolean(record.visit.arrivedAt) || visit.status === "completed";

  const status = APPOINTMENT_STATUS[visit.status] ?? APPOINTMENT_STATUS.scheduled!;
  const editable = visit.status === "scheduled" || visit.status === "unscheduled";
  const restorable = visit.status === "skipped" || visit.status === "cancelled";

  return (
    <div className="grid gap-6">
      <PageHeader
        title={visit.local_date ? formatLocalDate(visit.local_date, "long") : "Visit without a date"}
        description={`${visit.service_type_name} for ${visit.customer_name}`}
        back={
          <Link href={visit.local_date ? `/schedule?date=${visit.local_date}` : "/schedule"} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Schedule
          </Link>
        }
      />

      {done ? <Alert tone="success">{done}</Alert> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          {editable ? (
            <Panel
                title="Move or reassign this visit"
                description={visit.subscription_id ? "Changes here apply to this visit only. To change every future visit, edit the plan." : undefined}>
              <div className="px-5 py-4">
                <RescheduleForm
                  id={visit.id}
                  version={visit.version}
                  localDate={visit.local_date ?? ""}
                  technicianId={visit.technician_id ?? ""}
                  windowStart={visit.window_start?.slice(0, 5) ?? ""}
                  windowEnd={visit.window_end?.slice(0, 5) ?? ""}
                  technicians={technicians.map((t) => ({ id: t.id, name: t.display_name }))}
                />
              </div>
            </Panel>
          ) : null}

          {editable ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Panel title="Skip" description="The visit stays on record and in the needs-attention list.">
                <div className="px-5 py-4">
                  <ReasonForm id={visit.id} version={visit.version} kind="skip" />
                </div>
              </Panel>
              <Panel title="Cancel" description="Nothing is charged for a cancelled visit.">
                <div className="px-5 py-4">
                  <ReasonForm id={visit.id} version={visit.version} kind="cancel" />
                </div>
              </Panel>
            </div>
          ) : null}

          {restorable ? (
            <Panel title={`${status.label}: ${visit.skip_reason ?? visit.cancel_reason ?? ""}`} description="Put it back on the schedule as it was.">
              <div className="px-5 py-4">
                <RestoreForm id={visit.id} version={visit.version} />
              </div>
            </Panel>
          ) : null}

          {worked ? <ServiceRecordPanel record={record} canAmend /> : null}

          {!editable && !restorable ? <Alert>This visit is {status.label.toLowerCase()} and can no longer be changed here.</Alert> : null}
        </div>

        <Panel title="Details">
          <div className="px-5 py-4">
            <Details
              items={[
                { label: "Status", value: <Badge tone={status.tone}>{status.label}</Badge> },
                { label: "Customer", value: <Link href={`/customers/${visit.customer_id}`} className="font-medium hover:underline">{visit.customer_name}</Link> },
                { label: "Address", value: visit.address },
                { label: "Window", value: formatWindow(visit.window_start, visit.window_end) },
                { label: "Technician", value: visit.technician_name ?? "Unassigned" },
                { label: "Plan", value: visit.plan_name ? `${visit.plan_name}${visit.is_initial ? ", first visit" : ""}` : "One-off visit" },
                ...(visit.price_cents !== null ? [{ label: "Price", value: <span className="tabular">{formatCents(visit.price_cents)}</span> }] : []),
                ...(visit.detached ? [{ label: "Arranged", value: "By hand; plan changes leave it alone" }] : []),
                ...(visit.notes ? [{ label: "Notes", value: <span className="whitespace-pre-line">{visit.notes}</span> }] : []),
              ]}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
