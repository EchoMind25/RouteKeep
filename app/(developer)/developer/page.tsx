import { CheckCircle, Warning, WarningOctagon } from "@phosphor-icons/react/ssr";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireDeveloper } from "@/lib/auth/session";
import { formatCents } from "@/lib/domain/money";
import { healthChecks, planUsage, tenantFlags, worstTone, type Tone } from "@/lib/ops/console-model";
import { loadConsole } from "@/lib/ops/console";

// OPS-01: one read-only page across every business: platform health, each
// business's size and problems, recent system errors, and (OPS-02) the audit of
// what developers looked at. No customer records are shown or reachable from here.

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const count = new Intl.NumberFormat("en-US");

function at(iso: string): string {
  return `${when.format(new Date(iso))} UTC`;
}

const TONE_LABEL: Record<Tone, string> = { success: "OK", neutral: "Info", warning: "Check", danger: "Act now" };
const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Pro", growth: "Growth" };
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
