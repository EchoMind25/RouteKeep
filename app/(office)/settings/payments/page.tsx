import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { paymentsStatus, refreshStripeStatus } from "@/lib/server/payments";
import { formatInstant } from "@/lib/ui/format";
import { connectStripeAction, refreshStripeAction, resolveIssueAction } from "./actions";

export const metadata: Metadata = { title: "Payments" };

const KIND: Record<string, string> = {
  amount_mismatch: "Amounts differ",
  unknown_payment: "Payment not on file",
  status_mismatch: "Status differs",
  refund_failed: "Refund failed",
  dispute: "Disputed payment",
};

// D-09, FR-BIL-02, FR-BIL-07: card and bank payments through the business's own Stripe account.
export default async function PaymentsSettingsPage({ searchParams }: { searchParams: Promise<{ return?: string; refresh?: string; error?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const q = await searchParams;
  // Back from Stripe's onboarding: ask Stripe where things stand now rather than waiting for its event.
  if (q.return && (member.role === "owner" || member.role === "admin")) await refreshStripeStatus(member).catch(() => undefined);
  const s = await paymentsStatus(member);
  const owner = member.role === "owner";
  const manage = owner || member.role === "admin";

  return (
    <div className="grid max-w-4xl gap-10">
      <section aria-labelledby="stripe-title" className="grid gap-3">
        <h2 id="stripe-title" className="text-md font-semibold">
          Card and bank payments
        </h2>
        <p className="max-w-[70ch] text-fg-muted">
          Customers pay invoices from their account page and can turn on autopay. Payments go through your own Stripe account, straight to your bank. Stripe sets the processing fee and takes it from each payment; RouteVerde adds nothing. Card and bank numbers are only ever typed into Stripe&apos;s own pages.
        </p>
        {q.error ? <Alert tone="danger">{q.error}</Alert> : null}
        {!s.configured ? (
          <Alert tone="warning" title="Not available yet">
            Online payments are switched off on this RouteVerde installation. Invoices can still be paid in cash or by check and recorded on the invoice.
          </Alert>
        ) : s.chargesEnabled ? (
          <Alert tone="success" title="Connected">
            Customers can pay online and set up autopay.{s.reconciledAt ? ` Last checked against Stripe ${formatInstant(s.reconciledAt, member.timezone)}.` : ""}
          </Alert>
        ) : s.accountId ? (
          <Alert tone="warning" title={s.detailsSubmitted ? "Stripe is reviewing your details" : "Finish setting up with Stripe"}>
            {s.detailsSubmitted ? "Stripe usually finishes in a few minutes, sometimes a day or two. Online payments switch on by themselves once it does." : "Stripe still needs a few details before it can send payments to your bank."}
          </Alert>
        ) : null}
        {s.configured ? (
          <div className="flex flex-wrap gap-3">
            {owner && !s.chargesEnabled ? (
              <form action={connectStripeAction}>
                <Button type="submit">{s.accountId ? "Continue with Stripe" : "Connect Stripe"}</Button>
              </form>
            ) : null}
            {manage && s.accountId ? (
              <form action={refreshStripeAction}>
                <Button type="submit" variant="secondary">
                  Check again
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
        {s.configured && !owner && !s.accountId ? <p className="text-sm text-fg-muted">Only the owner can connect the business&apos;s Stripe account.</p> : null}
      </section>

      {manage && s.accountId ? (
        <section aria-labelledby="recon-title" className="grid gap-3">
          <h2 id="recon-title" className="text-md font-semibold">
            Checks against Stripe
          </h2>
          <p className="max-w-[70ch] text-fg-muted">Every night your payments here are checked against Stripe. Anything missed is fixed on its own; anything that needs a person is listed here.</p>
          {s.issues.length ? (
            <ul className="grid divide-y divide-line rounded-panel border border-line bg-surface">
              {s.issues.map((i) => (
                <li key={i.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grid gap-1">
                    <p className="font-semibold">{KIND[i.kind] ?? i.kind}</p>
                    <p className="text-fg-muted">{i.details}</p>
                    <p className="text-sm text-fg-muted">
                      Found {formatInstant(i.foundAt, member.timezone)}. Stripe reference <span className="font-mono">{i.objectId}</span>
                    </p>
                  </div>
                  <form action={resolveIssueAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Mark as sorted
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing to look at">
              <p className="text-fg-muted">Your payments and Stripe agree.</p>
            </EmptyState>
          )}
        </section>
      ) : null}
    </div>
  );
}
