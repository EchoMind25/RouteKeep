import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Alert, Details, Panel, PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { centsToInput, formatCents } from "@/lib/domain/money";
import { describeRule } from "@/lib/domain/recurrence";
import { parseLocalDate, todayIn } from "@/lib/domain/time";
import { listTechnicians } from "@/lib/server/catalog";
import { getSubscription } from "@/lib/server/subscriptions";
import { formatLocalDate, formatWindow, SUBSCRIPTION_STATUS } from "@/lib/ui/format";
import { CancelPlanForm, PauseForm, SeriesForm, SimpleForm } from "./plan-forms";

export const metadata: Metadata = { title: "Plan" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function doneMessage(outcome: string | undefined, n: number): string | null {
  const visits = (k: number) => `${k} ${k === 1 ? "visit" : "visits"}`;
  switch (outcome) {
    case "changed":
      return `Saved. ${visits(n)} ${n === 1 ? "follows" : "follow"} the new settings; visits arranged by hand kept theirs.`;
    case "paused":
      return `Plan paused. ${visits(n)} came off the schedule.`;
    case "resumed":
      return `Plan resumed. ${visits(n)} back on the schedule.`;
    case "cancelled":
      return `Plan cancelled. ${visits(n)} removed; past visits and records are kept.`;
    case "cancelled_with_followup":
      return `Plan cancelled. ${visits(n)} removed. Visits arranged by hand were cancelled and are in the needs-attention list.`;
    case "reactivated":
      return `Plan reactivated. ${visits(n)} on the schedule.`;
    default:
      return null;
  }
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string; subscriptionId: string }>; searchParams: Promise<{ done?: string; n?: string }> }) {
  const query = await searchParams;
  const done = doneMessage(query.done, Number.parseInt(query.n ?? "0", 10) || 0);
  const member = await requireMember(OFFICE_ROLES);
  const { id: customerId, subscriptionId } = await params;
  if (!UUID.test(customerId) || !UUID.test(subscriptionId)) notFound();
  const [sub, technicians] = await Promise.all([getSubscription(member, subscriptionId), listTechnicians(member, { activeOnly: true })]);
  if (!sub || sub.customer_id !== customerId) notFound();

  const canSell = member.role !== "dispatcher";
  const status = SUBSCRIPTION_STATUS[sub.status] ?? SUBSCRIPTION_STATUS.active!;
  const ids = { id: sub.id, customerId, version: sub.version };
  const technicianName = technicians.find((t) => t.id === sub.preferred_technician_id)?.display_name;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={sub.plan_name}
        description={`${sub.customer_name}. ${describeRule(sub.rrule, parseLocalDate(sub.start_date))}.`}
        back={
          <Link href={`/customers/${customerId}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> {sub.customer_name}
          </Link>
        }
      />

      {done ? <Alert tone="success">{done}</Alert> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          {!canSell ? <Alert>Plans are changed by the office. You can still move single visits from the schedule.</Alert> : null}

          {canSell && sub.status !== "cancelled" ? (
            <Panel title="Change all future visits" description="Visits someone moved by hand keep their own date, person and window.">
              <div className="px-5 py-4">
                <SeriesForm
                  {...ids}
                  technicianId={sub.preferred_technician_id ?? ""}
                  windowStart={sub.preferred_window_start?.slice(0, 5) ?? ""}
                  windowEnd={sub.preferred_window_end?.slice(0, 5) ?? ""}
                  price={centsToInput(sub.price_cents)}
                  durationMin={sub.duration_min}
                  technicians={technicians.map((t) => ({ id: t.id, name: t.display_name }))}
                />
              </div>
            </Panel>
          ) : null}

          {canSell && sub.status === "active" ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Panel title="Pause" description="Visits inside the pause come off the schedule.">
                <div className="px-5 py-4">
                  <PauseForm {...ids} today={todayIn(member.timezone)} />
                </div>
              </Panel>
              <Panel title="Cancel plan">
                <div className="px-5 py-4">
                  <CancelPlanForm {...ids} futureVisits={sub.futureVisits} futureDetached={sub.futureDetached} />
                </div>
              </Panel>
            </div>
          ) : null}

          {canSell && sub.status === "paused" ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Panel
                  title="Paused"
                  description={`${sub.paused_from ? `Since ${formatLocalDate(sub.paused_from, "full")}` : ""}${sub.paused_until ? `, resumes ${formatLocalDate(sub.paused_until, "full")}` : ", until someone resumes it"}. ${sub.pause_reason ?? ""}`}>
                <div className="px-5 py-4">
                  <SimpleForm {...ids} kind="resume" />
                </div>
              </Panel>
              <Panel title="Cancel plan">
                <div className="px-5 py-4">
                  <CancelPlanForm {...ids} futureVisits={sub.futureVisits} futureDetached={sub.futureDetached} />
                </div>
              </Panel>
            </div>
          ) : null}

          {canSell && sub.status === "cancelled" ? (
            <Panel title={`Cancelled${sub.cancel_reason ? `: ${sub.cancel_reason}` : ""}`} description="Reactivating puts visits back on the schedule from today.">
              <div className="px-5 py-4">
                <SimpleForm {...ids} kind="reactivate" />
              </div>
            </Panel>
          ) : null}
        </div>

        <Panel title="Plan">
          <div className="px-5 py-4">
            <Details
              items={[
                { label: "Status", value: <Badge tone={status.tone}>{status.label}</Badge> },
                { label: "Started", value: formatLocalDate(sub.start_date, "full") },
                { label: "Per visit", value: <span className="tabular">{formatCents(sub.price_cents)}</span> },
                { label: "Technician", value: technicianName ?? "Assigned per visit" },
                { label: "Window", value: formatWindow(sub.preferred_window_start, sub.preferred_window_end) },
                { label: "Upcoming", value: `${sub.futureVisits} scheduled` },
                { label: "Autopay", value: sub.autopay ? "Requested" : "No" },
              ]}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
