// OPS-01: what the developer console shows, as pure functions over the rows
// the app.ops_* functions return. Thresholds live here so they are tested and
// changed in one place.

export type Tone = "neutral" | "success" | "warning" | "danger";

export interface OpsTenant {
  tenantId: string;
  name: string;
  plan: string;
  state: string;
  createdAt: string;
  members: number;
  activeCustomers: number;
  visitsCompleted30d: number;
  stripeChargesEnabled: boolean;
  whiteLabel: boolean;
  messagingLive: boolean;
  openReconciliation: number;
  stuckPayments: number;
  failedPayments7d: number;
  failedMessages7d: number;
  openSyncConflicts: number;
  lastBillingRun: string | null;
}

export interface OpsHealth {
  checked_at: string;
  tenants: number;
  tenants_new_30d: number;
  active_customers: number;
  outbox: { pending: number; retrying: number; oldest_pending_at: string | null };
  messages_24h: { sent: number; failed: number; suppressed: number };
  webhooks: { unprocessed: number; unprocessed_over_5m: number; errors_24h: number };
  payments: { succeeded_30d: number; succeeded_cents_30d: number; failed_7d: number; stuck: number };
  reconciliation_open: number;
  billing: { last_finished_at: string | null; unfinished_over_1h: number; runs_with_failures_7d: number };
  imports: { in_progress: number; failed_7d: number };
  exports: { in_progress: number; failed_7d: number };
  route_ai: { runs_7d: number; failed_7d: number };
  sync_conflicts_open: number;
}

/** D-11: active customer limit per plan. */
export const PLAN_CAPS: Record<string, number> = { starter: 300, pro: 1500, growth: 5000 };

export function planUsage(plan: string, activeCustomers: number): { cap: number | null; pct: number | null; tone: Tone } {
  const cap = PLAN_CAPS[plan] ?? null;
  if (!cap) return { cap: null, pct: null, tone: "neutral" };
  const pct = Math.round((activeCustomers / cap) * 100);
  return { cap, pct, tone: activeCustomers > cap ? "danger" : activeCustomers >= cap * 0.9 ? "warning" : "neutral" };
}

export interface Flag {
  label: string;
  tone: Tone;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What needs a look for one business, worst first. Empty means nothing to do. */
export function tenantFlags(t: OpsTenant): Flag[] {
  const flags: Flag[] = [];
  if (t.stuckPayments > 0) flags.push({ label: plural(t.stuckPayments, "stuck payment"), tone: "danger" });
  if (t.openReconciliation > 0) flags.push({ label: plural(t.openReconciliation, "Stripe mismatch", "Stripe mismatches"), tone: "danger" });
  if (planUsage(t.plan, t.activeCustomers).tone === "danger") flags.push({ label: "Over plan limit", tone: "danger" });
  if (t.failedPayments7d > 0) flags.push({ label: `${plural(t.failedPayments7d, "failed payment")} (7 days)`, tone: "warning" });
  if (t.failedMessages7d > 0) flags.push({ label: `${plural(t.failedMessages7d, "failed email")} (7 days)`, tone: "warning" });
  if (t.openSyncConflicts > 0) flags.push({ label: plural(t.openSyncConflicts, "sync conflict"), tone: "warning" });
  return flags;
}

export interface Check {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
}

function age(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

/** Platform health as a list of checks. Thresholds: OPS-01 in the PR. */
export function healthChecks(h: OpsHealth, now: Date): Check[] {
  const oldest = minutesSince(h.outbox.oldest_pending_at, now);
  const outboxTone: Tone = oldest === null ? "success" : oldest > 60 ? "danger" : oldest > 15 ? "warning" : "success";
  const lastBilling = minutesSince(h.billing.last_finished_at, now);
  return [
    {
      key: "outbox",
      label: "Email queue",
      value: plural(h.outbox.pending, "waiting", "waiting"),
      detail: oldest === null ? "Nothing waiting." : `Oldest waiting ${age(oldest)}; ${h.outbox.retrying} retrying.`,
      tone: outboxTone,
    },
    {
      key: "messages",
      label: "Emails, last 24 hours",
      value: `${h.messages_24h.sent} sent`,
      detail: `${h.messages_24h.failed} failed or bounced, ${h.messages_24h.suppressed} suppressed.`,
      tone: h.messages_24h.failed > 0 ? "warning" : "success",
    },
    {
      key: "webhooks",
      label: "Webhooks",
      value: `${h.webhooks.unprocessed} unprocessed`,
      detail: `${h.webhooks.unprocessed_over_5m} older than 5 min; ${h.webhooks.errors_24h} errors in 24 hours.`,
      tone: h.webhooks.unprocessed_over_5m > 0 ? "danger" : h.webhooks.errors_24h > 0 ? "warning" : "success",
    },
    {
      key: "payments",
      label: "Payments",
      value: plural(h.payments.stuck, "stuck payment"),
      detail: `${h.payments.failed_7d} failed in 7 days; ${h.payments.succeeded_30d} succeeded in 30 days.`,
      tone: h.payments.stuck > 0 ? "danger" : h.payments.failed_7d > 0 ? "warning" : "success",
    },
    {
      key: "reconciliation",
      label: "Stripe reconciliation",
      value: `${h.reconciliation_open} open`,
      detail: "Charges where Stripe and RouteVerde disagree.",
      tone: h.reconciliation_open > 0 ? "danger" : "success",
    },
    {
      key: "billing",
      label: "Billing runs",
      value: lastBilling === null ? "None yet" : `Last ${age(lastBilling)} ago`,
      detail: `${h.billing.unfinished_over_1h} unfinished after an hour; ${h.billing.runs_with_failures_7d} with failures in 7 days.`,
      tone: h.billing.unfinished_over_1h > 0 ? "danger" : h.billing.runs_with_failures_7d > 0 ? "warning" : "success",
    },
    {
      key: "imports",
      label: "Imports and exports",
      value: `${h.imports.in_progress + h.exports.in_progress} running`,
      detail: `${h.imports.failed_7d} imports and ${h.exports.failed_7d} exports failed in 7 days.`,
      tone: h.imports.failed_7d + h.exports.failed_7d > 0 ? "warning" : "success",
    },
    {
      key: "route_ai",
      label: "AI route planner",
      value: `${h.route_ai.runs_7d} runs in 7 days`,
      detail: `${h.route_ai.failed_7d} failed.`,
      tone: h.route_ai.failed_7d > 0 ? "warning" : "success",
    },
  ];
}

const ORDER: Record<Tone, number> = { danger: 3, warning: 2, neutral: 1, success: 0 };

export function worstTone(tones: Tone[]): Tone {
  return tones.reduce<Tone>((worst, t) => (ORDER[t] > ORDER[worst] ? t : worst), "success");
}
