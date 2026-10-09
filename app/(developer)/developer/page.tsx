import { CheckCircle, Warning, WarningOctagon } from "@phosphor-icons/react/ssr";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireDeveloper } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import {
  engineRows,
  errorDays,
  errorDaysSummary,
  formatRate,
  healthChecks,
  outOfOrderSummary,
  planUsage,
  sharingTotals,
  tenantFlags,
  worstTone,
  type SharingLevel,
  type Tone,
} from "@/lib/ops/console-model";
import { loadConsole } from "@/lib/ops/console";

// OPS-01: one read-only page across every business: platform health, each
// business's size and problems, recent system errors, and (OPS-02) the audit of
// what developers looked at. No customer records are shown or reachable from here.
// OPS-03: product signals (auto route outcomes, errors) from businesses that
// share them; names only for businesses that chose identified sharing (OPS-04).

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const count = new Intl.NumberFormat("en-US");

function at(iso: string): string {
  return `${when.format(new Date(iso))} UTC`;
}

const TONE_LABEL: Record<Tone, string> = { success: "OK", neutral: "Info", warning: "Check", danger: "Act now" };
const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Pro", growth: "Growth" };
const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const SHARING_LABEL: Record<SharingLevel, { title: string; detail: string }> = {
  none: { title: "Share nothing", detail: "Nothing is stored for these businesses." },
  anonymous: { title: "Share anonymously", detail: "Counted with no business attached." },
  identified: { title: "Share with name", detail: "Their name shows next to their errors." },
};
const SURFACE_LABEL: Record<string, string> = { office: "Office app", tech: "Tech app", portal: "Customer portal", public: "Public site", server: "Server", job: "Background job" };
const SOURCE_LABEL: Record<string, string> = { webhook: "Webhook", export: "Export", import: "Import", route_ai: "Route planner", reconciliation: "Reconciliation" };

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "danger") return <WarningOctagon size={18} aria-hidden className="text-danger" />;
  if (tone === "warning") return <Warning size={18} aria-hidden className="text-warning" />;
  return <CheckCircle size={18} aria-hidden className="text-success" />;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid gap-1 rounded-panel border border-line bg-surface px-5 py-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      {detail ? <p className="text-sm text-fg-muted">{detail}</p> : null}
    </div>
  );
}

export default async function DeveloperConsolePage() {
  const dev = await requireDeveloper();
  const data = await loadConsole(dev);
  const now = new Date(data.health.checked_at);
  const checks = healthChecks(data.health, now);
  const overall = worstTone(checks.map((c) => c.tone));
  const needsLook = data.tenants.filter((t) => tenantFlags(t).length > 0).length;
  const product = data.product;
  const engines = engineRows(product.routes);
  const errorSeries = errorDays(product.errors_by_day, product.days, now);
  const errorPeak = Math.max(1, ...errorSeries.map((d) => d.count));

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Developer console"
        description={`Every business on RouteVerde, read only. Checked ${at(data.health.checked_at)}. Each visit to this page is recorded.`}
      />

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Businesses" value={count.format(data.health.tenants)} detail={`${data.health.tenants_new_30d} new in 30 days`} />
        <Stat label="Active customers" value={count.format(data.health.active_customers)} detail="Across all businesses" />
        <Stat label="Payments, 30 days" value={formatCents(data.health.payments.succeeded_cents_30d)} detail={`${count.format(data.health.payments.succeeded_30d)} succeeded`} />
        <Stat label="Platform health" value={TONE_LABEL[overall]} detail={needsLook === 0 ? "No business needs a look" : `${needsLook} ${needsLook === 1 ? "business needs" : "businesses need"} a look`} />
      </section>

      <Panel title="Health" description="Queues and background jobs across all businesses.">
        <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4" aria-label="Health checks">
          {checks.map((c) => (
            <li key={c.key} className="grid content-start gap-1 bg-surface px-5 py-4" data-check={c.key} data-tone={c.tone}>
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <ToneIcon tone={c.tone} />
                {c.label}
                <span className="sr-only">: {TONE_LABEL[c.tone]}</span>
              </p>
              <p className="font-semibold text-fg tabular-nums">{c.value}</p>
              <p className="text-sm text-fg-muted">{c.detail}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-3">
        <h2 className="text-lg font-semibold text-fg">
          Businesses
        </h2>
        {data.tenants.length === 0 ? (
          <EmptyState title="No businesses yet">A business appears here as soon as someone finishes sign-up.</EmptyState>
        ) : (
          <Table label="Businesses">
            <THead>
              <tr>
                <TH>Business</TH>
                <TH>Plan</TH>
                <TH className="text-right">Active customers</TH>
                <TH className="text-right">Users</TH>
                <TH className="text-right">Visits, 30 days</TH>
                <TH>Payments</TH>
                <TH>Needs a look</TH>
              </tr>
            </THead>
            <TBody>
              {data.tenants.map((t) => {
                const usage = planUsage(t.plan, t.activeCustomers);
                const flags = tenantFlags(t);
                return (
                  <TR key={t.tenantId}>
                    <TD>
                      <p className="font-medium text-fg">{t.name}</p>
                      <p className="text-sm text-fg-muted">
                        {t.state} <span aria-hidden>|</span> since {day.format(new Date(t.createdAt))}
                        {t.whiteLabel ? (
                          <>
                            {" "}
                            <span aria-hidden>|</span> white label
                          </>
                        ) : null}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap">{PLAN_LABEL[t.plan] ?? t.plan}</TD>
                    <TD className="text-right tabular-nums">
                      {count.format(t.activeCustomers)}
                      {usage.cap ? (
                        <p className={usage.tone === "danger" ? "text-sm text-danger" : usage.tone === "warning" ? "text-sm text-warning" : "text-sm text-fg-muted"}>
                          {usage.pct}% of {count.format(usage.cap)}
                        </p>
                      ) : null}
                    </TD>
                    <TD className="text-right tabular-nums">{t.members}</TD>
                    <TD className="text-right tabular-nums">{count.format(t.visitsCompleted30d)}</TD>
                    <TD className="whitespace-nowrap">
                      {t.stripeChargesEnabled ? <Badge tone="success">Stripe connected</Badge> : <Badge>Not connected</Badge>}
                    </TD>
                    <TD>
                      {flags.length === 0 ? (
                        <span className="text-sm text-fg-muted">Nothing</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {flags.map((f) => (
                            <li key={f.label}>
                              <Badge tone={f.tone === "danger" ? "danger" : "warning"}>{f.label}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-fg">
            Recent errors
          </h2>
          <p className="text-sm text-fg-muted">Last 7 days, plus open reconciliation issues. Customer email failures are counted above, not listed, because they can quote the address.</p>
        </div>
        {data.errors.length === 0 ? (
          <Alert tone="success">No system errors in the last 7 days.</Alert>
        ) : (
          <Table label="Recent errors">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Source</TH>
                <TH>Business</TH>
                <TH>Error</TH>
              </tr>
            </THead>
            <TBody>
              {data.errors.map((e, i) => (
                <TR key={`${e.source}-${e.at}-${i}`}>
                  <TD className="whitespace-nowrap text-sm tabular-nums">{at(e.at)}</TD>
                  <TD className="text-sm">
                    <p className="font-medium">{SOURCE_LABEL[e.source] ?? e.source}</p>
                    <p className="text-fg-muted">{e.kind}</p>
                  </TD>
                  <TD className="text-sm">{e.tenantName ?? "Platform"}</TD>
                  <TD className="font-mono text-sm break-words">{e.error}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <section aria-labelledby="product-signals" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="product-signals" className="text-lg font-semibold text-fg">
            Product signals
          </h2>
          <p className="text-sm text-fg-muted">
            Last {product.days} days, from businesses that share product data. Counts and scrubbed error text only: no customers, no people. A business name shows only where that business chose to share it.
          </p>
        </div>

        <ul aria-label="Data sharing choices" className="grid gap-3 sm:grid-cols-3">
          {sharingTotals(product.sharing).map((s) => (
            <li key={s.level} data-sharing={s.level}>
              <Stat
                label={SHARING_LABEL[s.level].title}
                value={`${count.format(s.count)} ${s.count === 1 ? "business" : "businesses"}`}
                detail={`${s.share === null ? "" : `${formatRate(s.share)} of all. `}${SHARING_LABEL[s.level].detail}`}
              />
            </li>
          ))}
        </ul>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-md font-semibold text-fg">Auto routes</h3>
            <p className="text-sm text-fg-muted">How dispatchers answer a proposed route. Changed by hand counts stops moved on a lane after its auto route was saved.</p>
          </div>
          {engines.length === 0 ? (
            <p className="rounded-panel border border-dashed border-line-strong px-5 py-4 text-sm text-fg-muted">No route proposals yet. They appear here once a dispatcher previews an auto route.</p>
          ) : (
            <Table label="Route proposals by engine" className="text-sm">
              <THead>
                <tr>
                  <TH>Engine</TH>
                  <TH className="text-right">Shown</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">Dismissed</TH>
                  <TH className="text-right">Undone after saving</TH>
                  <TH className="text-right">Changed by hand after</TH>
                </tr>
              </THead>
              <TBody>
                {engines.map((r) => (
                  <TR key={r.engine}>
                    <TD className="font-medium">{r.label}</TD>
                    <TD className="text-right tabular-nums">{count.format(r.shown)}</TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(r.acceptedRate)}
                      <p className="text-fg-muted">{count.format(r.accepted)}</p>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(r.dismissedRate)}
                      <p className="text-fg-muted">{count.format(r.dismissed)}</p>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(r.undoneRate)}
                      <p className="text-fg-muted">{count.format(r.undone)}</p>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {count.format(r.manualChange)} {r.manualChange === 1 ? "stop" : "stops"}
                      <p className="text-fg-muted">{r.manualChangePerAccepted === null ? "n/a" : `${r.manualChangePerAccepted.toFixed(1)} per saved route`}</p>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <p className="text-sm text-fg-muted" data-testid="out-of-order">
            <span className="font-medium text-fg">Technicians: </span>
            {outOfOrderSummary(product.out_of_order, product.days)}
          </p>
        </div>

        <Panel title="Errors per day" description={`Crashes and failed requests in the office app, tech app, portal, public site and server, last ${product.days} days (UTC).`}>
          <div className="grid gap-3 px-5 py-4">
            <div aria-hidden className="flex h-16 items-end gap-px" data-testid="error-strip">
              {errorSeries.map((d) => (
                <div
                  key={d.day}
                  title={`${short.format(new Date(`${d.day}T00:00:00Z`))}: ${d.count}`}
                  className={d.count > 0 ? "flex-1 bg-danger" : "flex-1 bg-line"}
                  style={{ height: d.count > 0 ? `${Math.max(8, Math.round((d.count / errorPeak) * 100))}%` : "2px" }}
                />
              ))}
            </div>
            <p className="text-sm text-fg-muted">{errorDaysSummary(errorSeries, (iso) => short.format(new Date(`${iso}T00:00:00Z`)))}</p>
          </div>
        </Panel>

        <div className="grid gap-3">
          <h3 className="text-md font-semibold text-fg">Top errors, last 7 days</h3>
          {data.productErrors.length === 0 ? (
            <Alert tone="success">No errors reported from the apps in the last 7 days.</Alert>
          ) : (
            <Table label="Top errors">
              <THead>
                <tr>
                  <TH>Error</TH>
                  <TH>Where</TH>
                  <TH className="text-right">Count</TH>
                  <TH>First and last seen</TH>
                  <TH>Versions</TH>
                  <TH>Business</TH>
                </tr>
              </THead>
              <TBody>
                {data.productErrors.map((e) => (
                  <TR key={`${e.fingerprint}-${e.name}-${e.surface}`}>
                    <TD className="text-sm">
                      <p className="font-mono break-words">{e.message ?? "No message"}</p>
                      <p className="text-fg-muted">{e.kind ?? e.name}</p>
                    </TD>
                    <TD className="text-sm">
                      <p>{SURFACE_LABEL[e.surface] ?? e.surface}</p>
                      {e.route ? <p className="font-mono text-fg-muted">{e.route}</p> : null}
                    </TD>
                    <TD className="text-right tabular-nums">{count.format(e.occurrences)}</TD>
                    <TD className="whitespace-nowrap text-sm tabular-nums">
                      <p>{at(e.firstHour)}</p>
                      <p className="text-fg-muted">{at(e.lastHour)}</p>
                    </TD>
                    <TD className="font-mono text-sm">{e.versions.length > 0 ? e.versions.join(", ") : <span className="font-sans text-fg-muted">Unknown</span>}</TD>
                    <TD className="text-sm">{e.businesses.length > 0 ? e.businesses.join(", ") : <span className="text-fg-muted">Anonymous</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-md font-semibold text-fg">Businesses sharing their name</h3>
            <p className="text-sm text-fg-muted">The 20 with the most errors in {product.days} days. Only businesses that chose to share with their name are listed.</p>
          </div>
          {product.identified.length === 0 ? (
            <p className="rounded-panel border border-dashed border-line-strong px-5 py-4 text-sm text-fg-muted">No business has shared events with its name in this period.</p>
          ) : (
            <Table label="Businesses sharing their name">
              <THead>
                <tr>
                  <TH>Business</TH>
                  <TH className="text-right">Events</TH>
                  <TH className="text-right">Errors</TH>
                </tr>
              </THead>
              <TBody>
                {product.identified.map((b) => (
                  <TR key={b.tenant_id}>
                    <TD className="font-medium">{b.name}</TD>
                    <TD className="text-right tabular-nums">{count.format(b.events)}</TD>
                    <TD className="text-right tabular-nums">{count.format(b.errors)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      <div className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-fg">
            Developer activity
          </h2>
          <p className="text-sm text-fg-muted">The last 25 developer actions. This record cannot be edited or deleted.</p>
        </div>
        <Table label="Developer activity">
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>Action</TH>
            </tr>
          </THead>
          <TBody>
            {data.audit.map((a, i) => (
              <TR key={`${a.at}-${i}`}>
                <TD className="whitespace-nowrap text-sm tabular-nums">{at(a.at)}</TD>
                <TD className="text-sm">{a.actorEmail}</TD>
                <TD className="font-mono text-sm">{a.action}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
