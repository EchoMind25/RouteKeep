import { CalendarBlank, CreditCard, FilePdf, Receipt } from "@phosphor-icons/react/ssr";
import { randomUUID } from "node:crypto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert, Panel } from "@/components/ui/layout";
import { formatCents } from "@/lib/domain/money";
import { portalHome } from "@/lib/portal/data";
import { PAY_ERRORS, portalPayments, type PayErrorCode } from "@/lib/portal/payments";
import { portalSession } from "@/lib/portal/session";
import { formatInstant, formatLocalDate, formatWindow } from "@/lib/ui/format";
import { payInvoiceAction, setUpAutopayAction, signOutAction, turnOffAutopayAction } from "./actions";
import { RequestServiceForm, SignInForm } from "./forms";

// FR-POR-01/02: sign in by emailed link; then next visit, history with
// service records, invoices, and a way to ask for service.
export default async function PortalPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ expired?: string; paid?: string; autopay?: string; pay?: string }> }) {
  const { tenant } = await params;
  const { expired, paid, autopay: autopayDone, pay } = await searchParams;
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

  const [home, payments] = await Promise.all([portalHome(claims), portalPayments(claims)]);
  const next = home.upcoming[0];
  const payError = pay && pay in PAY_ERRORS ? PAY_ERRORS[pay as PayErrorCode] : null;
  const paidInvoice = paid ? home.invoices.find((i) => i.id === paid) : undefined;
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

      {payError ? <Alert tone="danger">{payError}</Alert> : null}
      {paidInvoice ? (
        <Alert tone="success" title="Thank you">
          {paidInvoice.status === "paid"
            ? `Invoice ${paidInvoice.number} is paid. A receipt is on its way to your email.`
            : `Your payment for invoice ${paidInvoice.number} is on its way. Card payments show here within a minute; bank payments take a few business days.`}
        </Alert>
      ) : null}
      {autopayDone === "1" ? (
        <Alert tone="success">{payments.autopay ? `Autopay is on with ${payments.autopay.label}.` : "Thanks. Autopay switches on as soon as Stripe confirms; bank accounts can take a day or two to verify."}</Alert>
      ) : null}
      {autopayDone === "off" ? <Alert tone="success">Autopay is off. Nothing more will be charged automatically.</Alert> : null}

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
                <span className="flex flex-wrap items-center gap-2 tabular">
                  {formatCents(i.total_cents)}
                  {i.status === "paid" ? (
                    <Badge tone="success">Paid</Badge>
                  ) : payments.processing.includes(i.id) ? (
                    <Badge tone="neutral">Payment on its way</Badge>
                  ) : (
                    <>
                      <Badge tone="warning">{formatCents(i.open_cents)} due</Badge>
                      {payments.online && i.open_cents > 0 ? (
                        <form action={payInvoiceAction}>
                          <input type="hidden" name="tenant" value={tenant} />
                          <input type="hidden" name="invoiceId" value={i.id} />
                          <input type="hidden" name="key" value={`pay-${randomUUID()}`} />
                          <SubmitButton size="sm" pendingLabel="Opening Stripe">
                            Pay {formatCents(i.open_cents)}
                            <span className="sr-only"> for invoice {i.number}</span>
                          </SubmitButton>
                        </form>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {home.balanceCents > 0 && !payments.online ? (
            <p className="border-t border-line px-5 py-3 text-sm text-fg-muted">
              Pay your technician at the next visit{home.office?.phone ? ` or call ${home.office.phone}` : ""}.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {payments.online || payments.autopay ? (
        // FR-BIL-02, CR-06: autopay, what it means, and a way to stop it.
        <Panel title="Autopay" description="Each new invoice is paid when it's issued, and you get a receipt every time.">
          <div className="grid gap-4 px-5 py-4">
            {payments.autopay ? (
              <>
                <p className="flex items-center gap-2">
                  <CreditCard size={20} className="shrink-0 text-accent" aria-hidden />
                  <span>
                    On, with <span className="font-medium">{payments.autopay.label}</span>, since {formatInstant(payments.autopay.since, home.timeZone)}.
                  </span>
                </p>
                <details className="text-sm text-fg-muted">
                  <summary className="cursor-pointer font-medium text-fg">What you agreed to</summary>
                  <p className="mt-2 max-w-[65ch]">{payments.autopay.consent}</p>
                </details>
                <div className="flex flex-wrap gap-3">
                  {payments.online ? (
                    <form action={setUpAutopayAction}>
                      <input type="hidden" name="tenant" value={tenant} />
                      <input type="hidden" name="key" value={randomUUID()} />
                      <SubmitButton variant="secondary" pendingLabel="Opening Stripe">
                        Use a different card or bank
                      </SubmitButton>
                    </form>
                  ) : null}
                  <form action={turnOffAutopayAction}>
                    <input type="hidden" name="tenant" value={tenant} />
                    <ConfirmSubmitButton variant="ghost" confirmLabel="Confirm: turn off autopay" pendingLabel="Turning off">
                      Turn off autopay
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="max-w-[65ch] text-sm text-fg-muted">{payments.consentText}</p>
                <div>
                  <form action={setUpAutopayAction}>
                    <input type="hidden" name="tenant" value={tenant} />
                    <input type="hidden" name="key" value={randomUUID()} />
                    <SubmitButton pendingLabel="Opening Stripe">Set up autopay</SubmitButton>
                  </form>
                </div>
                <p className="text-sm text-fg-muted">You enter your card or bank details on Stripe&apos;s secure page; we never see the numbers.</p>
              </>
            )}
          </div>
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
