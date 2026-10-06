import { ArrowLeft, MapPin, Phone, EnvelopeSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Alert, Details, Panel, PanelHeader, PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { formatPhone } from "@/lib/domain/contact";
import { formatCents } from "@/lib/domain/money";
import { describeRule } from "@/lib/domain/recurrence";
import { instantToZoned, parseLocalDate } from "@/lib/domain/time";
import { needsPinConfirmation } from "@/lib/providers/geocoder";
import { getCustomer, propertyAddress } from "@/lib/server/customers";
import { APPOINTMENT_STATUS, BILLING_MODE, formatLocalDate, formatWindow, SUBSCRIPTION_STATUS } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Customer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getCustomer(member, id);
  if (!data) notFound();
  const { customer, properties, subscriptions, upcoming, history } = data;
  const created = (await searchParams).created === "1";
  const addressOf = new Map(properties.map((p) => [p.id, propertyAddress(p)]));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={customer.display_name}
        description={[customer.kind === "commercial" ? "Business" : "Home", customer.status === "inactive" ? "Inactive" : null].filter(Boolean).join(", ")}
        back={
          <Link href="/customers" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> Customers
          </Link>
        }
      />

      {created ? (
        <Alert tone="success" title="Customer saved">
          {upcoming.length ? `${upcoming.length} upcoming ${upcoming.length === 1 ? "visit is" : "visits are"} on the schedule.` : "Add a plan when they are ready to book."}
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <Panel>
            <PanelHeader title="Plans" description={subscriptions.length ? undefined : "No plan yet."} />
            {subscriptions.length ? (
              <ul className="divide-y divide-line">
                {subscriptions.map((s) => {
                  const st = SUBSCRIPTION_STATUS[s.status] ?? SUBSCRIPTION_STATUS.active!;
                  return (
                    <li key={s.id} className="grid gap-1.5 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{s.plan_name}</p>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <p className="text-sm text-fg-muted">{describeRule(s.rrule, parseLocalDate(s.start_date))}</p>
                      <p className="text-sm text-fg-muted">
                        {formatCents(s.price_cents)} per visit
                        {s.initial_price_cents !== null ? `, first visit ${formatCents(s.initial_price_cents)}` : ""}. Billed {BILLING_MODE[s.billing_mode]?.toLowerCase()}
                        {s.autopay ? ", autopay requested" : ""}.
                      </p>
                      <p className="text-sm text-fg-muted">At {addressOf.get(s.property_id)}</p>
                      {s.status === "cancelled" && s.cancel_reason ? <p className="text-sm text-danger">Cancelled: {s.cancel_reason}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title="Upcoming visits" description={upcoming.length ? undefined : "Nothing scheduled."} />
            {upcoming.length ? (
              <ul className="divide-y divide-line">
                {upcoming.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="grid gap-0.5">
                      <Link href={`/schedule?date=${a.local_date}`} className="font-medium tabular hover:underline">
                        {formatLocalDate(a.local_date)}
                      </Link>
                      <p className="text-sm text-fg-muted">
                        {a.service_type_name}, {formatWindow(a.window_start, a.window_end)}
                        {a.technician_name ? `, ${a.technician_name}` : ", no technician yet"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.is_initial ? <Badge tone="accent">First visit</Badge> : null}
                      {a.price_cents !== null ? <span className="text-sm text-fg-muted tabular">{formatCents(a.price_cents)}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          {history.length ? (
            <Panel>
              <PanelHeader title="History" />
              <ul className="divide-y divide-line">
                {history.map((a) => {
                  const st = APPOINTMENT_STATUS[a.status] ?? APPOINTMENT_STATUS.scheduled!;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="grid gap-0.5">
                        <p className="font-medium tabular">{a.local_date ? formatLocalDate(a.local_date, "full") : "No date"}</p>
                        <p className="text-sm text-fg-muted">
                          {a.service_type_name}
                          {a.skip_reason ?? a.cancel_reason ? `: ${a.skip_reason ?? a.cancel_reason}` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="grid gap-6">
          <Panel>
            <PanelHeader title="Contact" />
            <div className="px-5 py-4">
              <Details
                items={[
                  {
                    label: <span className="inline-flex items-center gap-1.5"><Phone size={14} aria-hidden /> Phone</span>,
                    value: customer.phone ? <a href={`tel:${customer.phone}`} className="tabular hover:underline">{formatPhone(customer.phone)}</a> : <span className="text-fg-muted">None</span>,
                  },
                  {
                    label: <span className="inline-flex items-center gap-1.5"><EnvelopeSimple size={14} aria-hidden /> Email</span>,
                    value: customer.email ? <a href={`mailto:${customer.email}`} className="break-all hover:underline">{customer.email}</a> : <span className="text-fg-muted">None</span>,
                  },
                  {
                    label: "Texts",
                    value: customer.sms_opted_out_at ? "Opted out" : customer.sms_consent_at ? `Consent recorded ${formatLocalDate(instantToZoned(customer.sms_consent_at, member.timezone).date, "full")}` : "No consent on file",
                  },
                  { label: "Promotions", value: customer.email_opt_in ? "Opted in" : "Not opted in" },
                  ...(customer.notes ? [{ label: "Notes", value: <span className="whitespace-pre-line">{customer.notes}</span> }] : []),
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={properties.length === 1 ? "Property" : "Properties"} />
            <ul className="divide-y divide-line">
              {properties.map((p) => (
                <li key={p.id} className="grid gap-1.5 px-5 py-4">
                  <p className="flex items-start gap-2 font-medium">
                    <MapPin size={16} aria-hidden className="mt-0.5 shrink-0 text-fg-muted" />
                    {propertyAddress(p)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.lat === null ? (
                      <Badge tone="warning">Not on the map yet</Badge>
                    ) : needsPinConfirmation(p.geocode_confidence === null ? null : Number(p.geocode_confidence)) && !p.location_confirmed_at ? (
                      <Badge tone="warning">Pin needs a check</Badge>
                    ) : (
                      <Badge tone="success">{p.location_locked ? "Pin confirmed and locked" : "Located"}</Badge>
                    )}
                  </div>
                  {p.access_notes ? <p className="text-sm text-fg-muted">{p.access_notes}</p> : null}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
