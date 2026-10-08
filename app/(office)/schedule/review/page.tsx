import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { listReview, type ReviewItem } from "@/lib/server/review";
import { formatInstant, formatLocalDate } from "@/lib/ui/format";
import { resolveReviewAction } from "./actions";

export const metadata: Metadata = { title: "Field work to review" };

const DONE: Record<string, { tone: "success" | "warning"; text: string }> = {
  accepted: { tone: "success", text: "The visit now says what happened in the field." },
  kept: { tone: "success", text: "The office's version stands. The field records stay on the visit." },
  gone: { tone: "warning", text: "Someone had already decided that one." },
  unreadable: { tone: "warning", text: "That choice could not be read. Try again." },
};

/** What the office had done, in words, from what the server held when the phone's work arrived. */
function officeChange(item: ReviewItem): string {
  const d = item.details;
  if (d.server_status === "cancelled") return `the office had cancelled it${item.cancelReason ? ` (${item.cancelReason})` : ""}`;
  if (d.server_status === "skipped") return "the office had marked it skipped";
  if (d.server_status === "completed") return "it was already marked done";
  if (d.server_status === "unscheduled") return "the office had taken it off the schedule";
  if (item.officeTechnicianName && item.officeTechnicianName !== item.technicianName) return `the office had given it to ${item.officeTechnicianName}`;
  if (d.server_date && d.server_date !== d.device_date) return `the office had moved it to ${formatLocalDate(d.server_date)}`;
  return "the office had changed it";
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const items = await listReview(member);
  const done = DONE[(await searchParams).done ?? ""];

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Field work to review"
        description="Work recorded on a phone after the office changed the visit. The records are kept either way; choose what the visit should say."
        back={
          <Link href="/schedule" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Schedule
          </Link>
        }
      />
      {done ? <Alert tone={done.tone}>{done.text}</Alert> : null}
      {items.length === 0 ? (
        <EmptyState title="Nothing to review">When a technician finishes a visit offline that the office changed in the meantime, it shows up here.</EmptyState>
      ) : (
        <ul className="grid max-w-3xl gap-4">
          {items.map((item) => {
            const who = item.technicianName ?? "A technician";
            const what = item.kind === "completed_after_change" ? "completed" : `skipped${item.details.skip_reason ? ` (${item.details.skip_reason})` : ""}`;
            return (
              <li key={item.id}>
                <section aria-labelledby={`review-${item.id}`} className="grid gap-3 rounded-panel border border-line bg-surface p-5">
                  <div className="grid gap-1">
                    <h2 id={`review-${item.id}`} className="font-semibold">
                      {item.customerName}, {item.serviceType}
                    </h2>
                    <p>
                      {who} {what} this visit on {formatInstant(item.details.device_at, item.timeZone)}, but {officeChange(item)}.
                    </p>
                    <p className="text-sm text-fg-muted">
                      {item.records === 0 ? "No product records." : `${item.records} product ${item.records === 1 ? "record" : "records"} saved.`}{" "}
                      <Link href={`/schedule/visits/${item.appointmentId}`} className="font-medium text-accent hover:underline">
                        Open the visit
                      </Link>
                    </p>
                  </div>
                  <form action={resolveReviewAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={item.id} />
                    <SubmitButton name="action" value="accept" pendingLabel="Saving">
                      {item.kind === "completed_after_change" ? "Mark it done" : "Mark it skipped"}
                    </SubmitButton>
                    <SubmitButton name="action" value="keep" variant="secondary" pendingLabel="Saving">
                      Keep the office&apos;s version
                    </SubmitButton>
                  </form>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
