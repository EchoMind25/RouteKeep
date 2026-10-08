import { CalendarBlank, FilePdf, Receipt } from "@phosphor-icons/react/ssr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/layout";
import { formatCents } from "@/lib/domain/money";
import { portalHome } from "@/lib/portal/data";
import { portalSession } from "@/lib/portal/session";
import { formatInstant, formatLocalDate, formatWindow } from "@/lib/ui/format";
import { signOutAction } from "./actions";
import { RequestServiceForm, SignInForm } from "./forms";

// FR-POR-01/02: sign in by emailed link; then next visit, history with
// service records, invoices, and a way to ask for service.
export default async function PortalPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ expired?: string }> }) {
  const { tenant } = await params;
  const { expired } = await searchParams;
  const claims = await portalSession(tenant);
  if (!claims) {
    return (
      <section aria-labelledby="sign-in" className="grid gap-4">
        <h1 id="sign-in" className="text-2xl font-semibold tracking-tight">
          Sign in to your account
        </h1>
        <p className="max-w-[60ch] text-fg-muted">See your next visit, your service records and invoices, and ask for service. Enter the email address you gave us and we&apos;ll send you a link. No password.</p>
        {expired ? <p className="font-medium text-danger">That link has expired or was already used. Ask for a new one below.</p> : null}
        <SignInForm tenant={tenant} />
      </section>
    );
  }

  const home = await portalHome(claims);
  const next = home.upcoming[0];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hi {home.customer.greeting}</h1>
        <form action={signOutAction}>
          <input type="hidden" name="tenant" value={tenant} />
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      <Panel title="Next visit">
        <div className="flex items-start gap-3 px-5 py-4">
          <CalendarBlank size={24} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          {next ? (
            <div>
              <p className="text-lg font-semibold">{formatLocalDate(next.local_date!, "full")}</p>
              <p className="text-fg-muted">
                {next.service}
                {next.window_start || next.window_end ? `, ${formatWindow(next.window_start, next.window_end)}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-fg-muted">Nothing on the calendar yet. Use the form below to ask for a visit.</p>
          )}
        </div>
      </Panel>

      {home.invoices.length ? (
        <Panel title="Invoices" description={home.balanceCents > 0 ? `You owe ${formatCents(home.balanceCents)}.` : "Nothing owed. Thank you."}>
          <ul className="divide-y divide-line">
            {home.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="flex items-center gap-2">
                  <Receipt size={18} className="text-fg-muted" aria-hidden />
                  <a href={`/p/${tenant}/invoices/${i.id}`} className="font-medium hover:underline">
                    Invoice {i.number}
                  </a>
                  <span className="text-sm text-fg-muted">{i.issued_at ? formatInstant(i.issued_at, home.timeZone) : ""}</span>
                </span>
                <span className="flex items-center gap-2 tabular">
                  {formatCents(i.total_cents)}
                  {i.status === "paid" ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">{formatCents(i.open_cents)} due</Badge>}
                </span>
              </li>
            ))}
          </ul>
          {home.balanceCents > 0 ? (
            <p className="border-t border-line px-5 py-3 text-sm text-fg-muted">
              Paying online is coming soon. For now, pay your technician at the next visit{home.office?.phone ? ` or call ${home.office.phone}` : ""}.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Service history" description="Each visit's record lists every product applied, where, and how much.">
        {home.done.length ? (
          <ul className="divide-y divide-line">
            {home.done.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span>
                  <span className="font-medium">{formatLocalDate(v.local_date!, "full")}</span>
                  <span className="text-fg-muted">, {v.service}</span>
                </span>
                <a href={`/p/${tenant}/visits/${v.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                  <FilePdf size={16} aria-hidden /> Service record<span className="sr-only"> for {formatLocalDate(v.local_date!, "full")}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-fg-muted">Records show up here after each visit.</p>
        )}
      </Panel>

      <Panel title="Request service" description="Something bugging you between visits? Tell us and we'll get you on the schedule.">
        <div className="px-5 py-4">
          <RequestServiceForm tenant={tenant} properties={home.properties} />
        </div>
      </Panel>
    </>
  );
}
