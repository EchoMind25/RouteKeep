import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { messagingSettings, recentMessages, TEMPLATE_LABEL } from "@/lib/server/messages";
import { formatInstant, pluralize } from "@/lib/ui/format";
import { goLiveAction } from "./actions";
import { TenDlcForm } from "./ten-dlc-form";

export const metadata: Metadata = { title: "Messages" };

// FR-MSG-01..05, FR-MIG-19: what customers are sent, what is held back and why.
export default async function MessagesSettingsPage() {
  const member = await requireMember(OFFICE_ROLES);
  const [settings, messages] = await Promise.all([messagingSettings(member), recentMessages(member, { limit: 40 })]);
  const manage = canManage(member.role);
  return (
    <div className="grid max-w-4xl gap-10">
      <section aria-labelledby="email-title" className="grid gap-3">
        <h2 id="email-title" className="text-md font-semibold">
          Email
        </h2>
        <p className="text-fg-muted">
          Customers get a reminder the day before a visit, a service complete notice with their record, and their invoices. Every email has your business name, license and an unsubscribe link.
        </p>
        {settings.emailProvider === "resend" ? (
          <Alert tone="success">Email is on.</Alert>
        ) : settings.emailProvider === "log" ? (
          <Alert tone="warning">Test mode: emails are written to files on this computer, not sent.</Alert>
        ) : (
          <Alert tone="warning" title="Email is not set up yet">
            Messages are listed below as not sent until an email service is connected.
          </Alert>
        )}
      </section>

      {settings.imported > 0 ? (
        <section aria-labelledby="live-title" className="grid gap-3">
          <h2 id="live-title" className="text-md font-semibold">
            Imported customers
          </h2>
          {settings.liveAt ? (
            <p className="text-fg-muted">Live since {formatInstant(settings.liveAt, member.timezone)}. Imported customers get messages like everyone else.</p>
          ) : (
            <>
              <p className="text-fg-muted">
                {pluralize(settings.imported, "imported customer")} get no messages yet, so nobody hears from two systems at once while you switch over. Go live when this app is the one you run on.
              </p>
              {manage ? (
                <form action={goLiveAction}>
                  <Button type="submit">Go live</Button>
                </form>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby="sms-title" className="grid gap-3">
        <h2 id="sms-title" className="text-md font-semibold">
          Texts
        </h2>
        <p className="text-fg-muted">
          Carriers require every business that texts customers to register its brand first (10DLC). Texts stay off until that registration is approved, and only go to customers whose consent is on file.
        </p>
        <Badge tone={settings.tenDlc ? "accent" : "neutral"}>{settings.tenDlc ? "Details saved, not submitted yet" : "Not started"}</Badge>
        <TenDlcForm initial={settings.tenDlc ?? {}} readOnly={!manage} />
      </section>

      <section aria-labelledby="log-title" className="grid gap-3">
        <h2 id="log-title" className="text-md font-semibold">
          Recent messages
        </h2>
        {messages.length === 0 ? (
          <EmptyState title="Nothing sent yet">Messages show up here with their outcome, including any that were held back and why.</EmptyState>
        ) : (
          <Table label="Recent messages">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Customer</TH>
                <TH>Message</TH>
                <TH>Outcome</TH>
              </tr>
            </THead>
            <TBody>
              {messages.map((m) => (
                <TR key={m.id}>
                  <TD className="tabular">{formatInstant(m.created_at, member.timezone)}</TD>
                  <TD>{m.customer_id ? <Link href={`/customers/${m.customer_id}`} className="hover:underline">{m.display_name}</Link> : ""}</TD>
                  <TD>{TEMPLATE_LABEL[m.template] ?? m.template}</TD>
                  <TD>
                    {m.status === "sent" ? <Badge tone="success">Sent</Badge> : m.status === "suppressed" ? <span className="text-sm text-fg-muted">Not sent: {m.suppressed_reason}</span> : <Badge tone="danger">Failed</Badge>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
