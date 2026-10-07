import { ArrowLeft, ArrowRight, MapPinSimpleArea, Plus, WarningCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { DispatchBoard } from "@/components/dispatch/board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { addDays, isLocalDate, todayIn, type LocalDate } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { publicEnv } from "@/lib/public-env";
import { getBoard, nextDays } from "@/lib/server/dispatch";
import { aiPlannerAvailable } from "@/lib/server/route-ai";
import { listRecordsDue, type RecordDueVisit } from "@/lib/server/records";
import { countOpenReview } from "@/lib/server/review";
import { getDay, type DayStop } from "@/lib/server/schedule";
import { APPOINTMENT_STATUS, formatInstant, formatLocalDate, formatWindow, pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Schedule" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function StopRow({ stop, index }: { stop: DayStop; index: number }) {
  const status = APPOINTMENT_STATUS[stop.status] ?? APPOINTMENT_STATUS.scheduled!;
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-3 px-4 py-3">
      {/* FR-DSP-05: one stop number, the same on map, list and technician app: the stop's place in the route order. */}
      <span className="grid size-7 place-items-center rounded-pill border border-line-strong text-xs font-semibold tabular" aria-label={`Stop ${index + 1}`}>
        {index + 1}
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Link href={`/schedule/visits/${stop.id}`} className="truncate font-semibold text-fg hover:underline">
            {stop.customerName}
          </Link>
          <span className="text-sm text-fg-muted tabular">{formatWindow(stop.windowStart, stop.windowEnd)}</span>
        </div>
        <p className="truncate text-sm text-fg-muted">{stop.address}</p>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Badge>{stop.serviceType}</Badge>
          {stop.isInitial ? <Badge tone="accent">First visit</Badge> : null}
          {stop.status !== "scheduled" ? <Badge tone={status.tone}>{status.label}</Badge> : null}
          {stop.needsPin ? (
            <Badge tone="warning">
              <MapPinSimpleArea size={12} aria-hidden /> Check pin
            </Badge>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Lane({ title, color, stops, empty }: { title: string; color?: number; stops: DayStop[]; empty: string }) {
  const minutes = stops.reduce((sum, s) => sum + s.durationMin, 0);
  return (
    <section className="min-w-0 overflow-hidden rounded-panel border border-line bg-surface" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        {color !== undefined ? (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-pill text-xs font-bold"
            style={{ backgroundColor: `var(--rk-route-${color})`, color: `var(--rk-route-ink-${color})` }}
            aria-hidden
          >
            {initials(title)}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="text-sm text-fg-muted tabular">
            {pluralize(stops.length, "stop")}
            {minutes ? `, about ${Math.round(minutes / 6) / 10} h on site` : ""}
          </p>
        </div>
      </header>
      {stops.length ? (
        <ol className="divide-y divide-line">
          {stops.map((s, i) => (
            <StopRow key={s.id} stop={s} index={i} />
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-fg-muted">{empty}</p>
      )}
    </section>
  );
}

/** Field work that needs a person (CR-02, NFR-02), above either view of the day. */
function FieldAlerts({ due, review }: { due: RecordDueVisit[]; review: number }) {
  const shown = due.slice(0, 5);
  return (
    <>
      {due.length ? (
        // CR-02: started on a phone more than 20 hours ago and no record has reached the office.
        <Alert
          tone={due.some((d) => d.overdue) ? "danger" : "warning"}
          title={due.length === 1 ? "1 started visit has no record yet" : `${due.length} started visits have no record yet`}
          className="mb-2"
        >
          <p>Records are due within 24 hours of the application. Nothing has reached the office for these; the phone may be waiting for a connection.</p>
          <ul className="mt-1 grid gap-0.5">
            {shown.map((d) => (
              <li key={d.id}>
                <Link href={`/schedule/visits/${d.id}`} className="font-semibold underline-offset-2 hover:underline">
                  {d.customerName}
                </Link>
                {d.technicianName ? `, ${d.technicianName}` : ""}: {d.overdue ? "overdue since" : "due by"} {formatInstant(d.due, d.timeZone)}
              </li>
            ))}
          </ul>
          {due.length > shown.length ? <p className="mt-1">And {due.length - shown.length} more.</p> : null}
        </Alert>
      ) : null}
      {review > 0 ? (
        // NFR-02: field work that clashed with an office change waits for a person.
        <Alert tone="warning" className="mb-2">
          <Link href="/schedule/review" className="font-semibold underline-offset-2 hover:underline">
            {review === 1 ? "1 field visit to review" : `${review} field visits to review`}
          </Link>
          : finished on a phone after the office changed them.
        </Alert>
      ) : null}
    </>
  );
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string; done?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const today = todayIn(member.timezone);
  const { date: raw, done } = await searchParams;
  const date: LocalDate = raw && isLocalDate(raw) ? raw : today;
  // Started now, awaited with the day's data below.
  const attention = Promise.all([listRecordsDue(member), countOpenReview(member)]);

  const header = (
    <PageHeader
      title={formatLocalDate(date, "long")}
      description={date === today ? "Today" : undefined}
      actions={
        <>
          <nav aria-label="Change day" className="flex items-center gap-1">
            <Button asChild variant="secondary" size="icon" aria-label="Previous day">
              <Link href={`/schedule?date=${addDays(date, -1)}`}>
                <ArrowLeft size={18} aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" disabled={date === today}>
              <Link href="/schedule">Today</Link>
            </Button>
            <Button asChild variant="secondary" size="icon" aria-label="Next day">
              <Link href={`/schedule?date=${addDays(date, 1)}`}>
                <ArrowRight size={18} aria-hidden />
              </Link>
            </Button>
          </nav>
          <Button asChild>
            <Link href="/customers/new">
              <Plus size={18} aria-hidden /> New customer
            </Link>
          </Button>
        </>
      }
    />
  );

  // UX-04: empty states teach the next step.
  const empty = (
    <EmptyState
      title="Nothing scheduled yet"
      action={
        <>
          <Button asChild>
            <Link href="/setup">Finish setup</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/customers/new">Add a customer</Link>
          </Button>
        </>
      }
    >
      Add your technicians and plans, then sell a plan to a customer. Visits appear here automatically, 60 days ahead.
    </EmptyState>
  );

  if (isEnabled("dispatchBoard")) {
    const [board, [due, review]] = await Promise.all([getBoard(member, date), attention]);
    const nothing = board.technicians.length === 0 && board.stops.length === 0 && board.queue.length === 0;
    return (
      <div className="grid gap-2">
        {header}
        <FieldAlerts due={due} review={review} />
        {nothing ? (
          empty
        ) : (
          // FR-DSP-01: lanes and map with one selection. Keyed by day so a new day starts clean.
          <DispatchBoard
            key={date}
            aiPlanner={aiPlannerAvailable()}
            date={date}
            nextDays={nextDays(date)}
            technicians={board.technicians}
            stops={board.stops}
            queue={board.queue}
            routes={board.routes}
            start={board.start}
            mapStyleUrl={publicEnv.mapStyleUrl}
            notice={done === "pin" ? "Pin confirmed. Drive times now use it." : undefined}
          />
        )}
      </div>
    );
  }

  // The day list: what the schedule was before the board, kept behind the flag as a fallback (ENG-10).
  const [day, [due, review]] = await Promise.all([getDay(member, date), attention]);
  const lanes = day.technicians.map((t) => ({ tech: t, stops: day.stops.filter((s) => s.technicianId === t.id) }));
  const unassigned = day.stops.filter((s) => !s.technicianId);
  const hasAnything = day.stops.length > 0 || day.queue.length > 0;

  return (
    <div className="grid gap-2">
      {header}
      <FieldAlerts due={due} review={review} />
      {!hasAnything && day.technicians.length === 0 ? (
        empty
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {lanes.map(({ tech, stops }) => (
              <Lane key={tech.id} title={tech.display_name} color={tech.color_index} stops={stops} empty="No stops this day." />
            ))}
            {unassigned.length > 0 || lanes.length === 0 ? <Lane title="Unassigned" stops={unassigned} empty="Every stop has a technician." /> : null}
          </div>

          {/* FR-DSP-04: skipped, cancelled and unscheduled work stays in view. */}
          <aside className="grid gap-3 xl:sticky xl:top-6" aria-label="Needs attention">
            <h2 className="flex items-center gap-2 font-semibold">
              <WarningCircle size={18} aria-hidden className="text-warning" /> Needs attention
            </h2>
            {day.queue.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing waiting. Skipped, cancelled and unassigned visits show up here.</p>
            ) : (
              <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
                {day.queue.map((q) => {
                  const st = APPOINTMENT_STATUS[q.status] ?? APPOINTMENT_STATUS.scheduled!;
                  return (
                    <li key={q.id} className="grid gap-1 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/schedule/visits/${q.id}`} className="truncate font-medium hover:underline">
                          {q.customerName}
                        </Link>
                        <Badge tone={q.status === "scheduled" ? "warning" : st.tone}>{q.status === "scheduled" ? "No technician" : st.label}</Badge>
                      </div>
                      <p className="text-sm text-fg-muted">
                        {q.localDate ? formatLocalDate(q.localDate) : "No date yet"}
                        {q.reason ? `: ${q.reason}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
