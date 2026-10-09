import "server-only";
import { withServiceRole } from "@/lib/db/service";
import { requireStripe, Stripe, stripe } from "@/lib/providers/payments";
import { syncAccount } from "./stripe-accounts";
import { applyIntent, applyRefund, flagIssue } from "./stripe-ledger";
import { sweepStuckPayments, type SweepResult } from "./stuck-payments";

// FR-BIL-07: each night, the ledger against Stripe for each connected
// business. Anything a lost webhook should have told us is applied the same
// way the webhook would have (so the ledger catches up on its own); what
// cannot be squared is listed for the owner in Settings, Payments.
//
// Three phases (intents, refunds, sweep) so the Inngest runner can give each
// its own step under the 20 s limit (D-04); reconcileTenant runs them in turn
// for /api/cron and the scripts. Each phase stops starting new work at its
// deadline; the 3-day window means the next night picks up what was left.

const WINDOW_DAYS = 3;
const MAX_OBJECTS = 1000;
/** D-04: leave room under the 20 s step limit for the Stripe call in flight. */
export const PHASE_BUDGET_MS = 15_000;

export interface ReconcileResult {
  intents: number;
  refunds: number;
  fixed: number;
  issues: number;
  swept?: Omit<SweepResult, "errors"> & { errors: number };
}

async function connectedAccount(tenantId: string): Promise<string | null> {
  if (!stripe()) return null;
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select("stripe_account_id").where("id", "=", tenantId).executeTakeFirst());
  return t?.stripe_account_id ?? null;
}

const windowStart = (now: Date) => Math.floor(now.getTime() / 1000) - WINDOW_DAYS * 86_400;

/** Phase 1: the account, Stripe's recent intents, and our paid payments Stripe may not agree with. */
export async function reconcileIntents(tenantId: string, now: Date = new Date(), budgetMs = PHASE_BUDGET_MS): Promise<{ intents: number; fixed: number } | null> {
  const account = await connectedAccount(tenantId);
  if (!account) return null;
  const s = requireStripe();
  const opts = { stripeAccount: account };
  const deadline = Date.now() + budgetMs;
  const result = { intents: 0, fixed: 0 };

  await withServiceRole(async (tx) => syncAccount(tx, await s.accounts.retrieve(account)));

  const since = windowStart(now);
  const seen = new Set<string>();
  await s.paymentIntents.list({ created: { gte: since }, limit: 100 }, opts).autoPagingEach(async (pi: Stripe.PaymentIntent) => {
    if (++result.intents > MAX_OBJECTS || Date.now() > deadline) return false;
    seen.add(pi.id);
    if (!pi.metadata?.payment_id) return; // The business's own payments outside RouteVerde.
    const applied = await withServiceRole((tx) => applyIntent(tx, tenantId, pi, now));
    if (applied?.changed) result.fixed += 1;
  });

  // Ours says paid; Stripe must agree.
  const ours = await withServiceRole((tx) =>
    tx
      .selectFrom("payments")
      .select(["id", "stripe_payment_intent_id", "amount_cents"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "succeeded")
      .where("stripe_payment_intent_id", "is not", null)
      .where("received_at", ">=", new Date(since * 1000))
      .execute(),
  );
  for (const p of ours) {
    if (seen.has(p.stripe_payment_intent_id!)) continue;
    if (Date.now() > deadline) break;
    const pi = await s.paymentIntents.retrieve(p.stripe_payment_intent_id!, {}, opts).catch((error) => {
      // Only "no such intent" means not found; a network or API error must not be reported as a mismatch.
      if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") return null;
      throw error;
    });
    if (!pi || pi.status !== "succeeded") {
      await withServiceRole((tx) => flagIssue(tx, tenantId, { kind: "status_mismatch", objectId: p.stripe_payment_intent_id!, paymentId: p.id, details: `RouteVerde shows this payment as received; Stripe shows it as ${pi ? pi.status.replaceAll("_", " ") : "not found"}.` }));
    }
  }
  return result;
}

/** Phase 2: Stripe's recent refunds. */
export async function reconcileRefunds(tenantId: string, now: Date = new Date(), budgetMs = PHASE_BUDGET_MS): Promise<{ refunds: number; fixed: number } | null> {
  const account = await connectedAccount(tenantId);
  if (!account) return null;
  const deadline = Date.now() + budgetMs;
  const result = { refunds: 0, fixed: 0 };
  await requireStripe()
    .refunds.list({ created: { gte: windowStart(now) }, limit: 100 }, { stripeAccount: account })
    .autoPagingEach(async (r: Stripe.Refund) => {
      if (++result.refunds > MAX_OBJECTS || Date.now() > deadline) return false;
      if (await withServiceRole((tx) => applyRefund(tx, tenantId, r, now))) result.fixed += 1;
    });
  return result;
}

/** Phase 3: stuck payments, then autopay charges that never got an answer, then the reconciled-at stamp. */
export async function reconcileSweep(tenantId: string, now: Date = new Date(), budgetMs = PHASE_BUDGET_MS): Promise<SweepResult | null> {
  const account = await connectedAccount(tenantId);
  if (!account) return null;
  const swept = await sweepStuckPayments(tenantId, account, now, Date.now() + budgetMs);

  // Autopay payments too old to repeat safely and never answered.
  await withServiceRole(async (tx) => {
    const stale = await tx
      .selectFrom("payments")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("source", "=", "autopay")
      .where("status", "=", "pending")
      .where("stripe_payment_intent_id", "is", null)
      .where("created_at", "<", new Date(now.getTime() - 23 * 3_600_000))
      .execute();
    for (const p of stale) {
      await tx.updateTable("payments").set({ status: "canceled", failure_message: "No answer from Stripe; not charged by RouteVerde" }).where("tenant_id", "=", tenantId).where("id", "=", p.id).execute();
      await flagIssue(tx, tenantId, { kind: "status_mismatch", objectId: p.id, paymentId: p.id, details: "An autopay charge got no answer from Stripe for a day and was canceled. Check Stripe for a charge with this payment id before charging again." });
    }
    await tx.updateTable("tenants").set({ stripe_reconciled_at: now }).where("id", "=", tenantId).execute();
  });
  return swept;
}

export async function reconcileTenant(tenantId: string, now: Date = new Date()): Promise<ReconcileResult | null> {
  if (!(await connectedAccount(tenantId))) return null;
  const before = await openIssues(tenantId);
  const i = await reconcileIntents(tenantId, now);
  const r = await reconcileRefunds(tenantId, now);
  const swept = await reconcileSweep(tenantId, now);
  return {
    intents: i?.intents ?? 0,
    refunds: r?.refunds ?? 0,
    fixed: (i?.fixed ?? 0) + (r?.fixed ?? 0) + (swept?.moved ?? 0),
    issues: (await openIssues(tenantId)) - before,
    ...(swept ? { swept: { checked: swept.checked, moved: swept.moved, errors: swept.errors.length } } : {}),
  };
}

async function openIssues(tenantId: string): Promise<number> {
  const r = await withServiceRole((tx) => tx.selectFrom("reconciliation_issues").select((eb) => eb.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).where("resolved_at", "is", null).executeTakeFirstOrThrow());
  return Number(r.n);
}
