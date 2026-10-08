import "server-only";
import { withServiceRole } from "@/lib/db/service";
import { requireStripe, Stripe, stripe } from "@/lib/providers/payments";
import { syncAccount } from "./stripe-accounts";
import { applyIntent, applyRefund, flagIssue } from "./stripe-ledger";

// FR-BIL-07: each night, the ledger against Stripe for each connected
// business. Anything a lost webhook should have told us is applied the same
// way the webhook would have (so the ledger catches up on its own); what
// cannot be squared is listed for the owner in Settings, Payments.

const WINDOW_DAYS = 3;
const MAX_OBJECTS = 1000;

export interface ReconcileResult {
  intents: number;
  refunds: number;
  fixed: number;
  issues: number;
}

export async function reconcileTenant(tenantId: string, now: Date = new Date()): Promise<ReconcileResult | null> {
  if (!stripe()) return null;
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select(["stripe_account_id", "stripe_reconciled_at"]).where("id", "=", tenantId).executeTakeFirst());
  if (!t?.stripe_account_id) return null;
  const account = t.stripe_account_id;
  const s = requireStripe();
  const opts = { stripeAccount: account };
  const result: ReconcileResult = { intents: 0, refunds: 0, fixed: 0, issues: 0 };
  const before = await openIssues(tenantId);

  await withServiceRole(async (tx) => syncAccount(tx, await s.accounts.retrieve(account)));

  const since = Math.floor(now.getTime() / 1000) - WINDOW_DAYS * 86_400;
  const seen = new Set<string>();
  await s.paymentIntents.list({ created: { gte: since }, limit: 100 }, opts).autoPagingEach(async (pi: Stripe.PaymentIntent) => {
    if (++result.intents > MAX_OBJECTS) return false;
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
    const pi = await s.paymentIntents.retrieve(p.stripe_payment_intent_id!, {}, opts).catch((error) => {
      // Only "no such intent" means not found; a network or API error must not be reported as a mismatch.
      if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") return null;
      throw error;
    });
    if (!pi || pi.status !== "succeeded") {
      await withServiceRole((tx) => flagIssue(tx, tenantId, { kind: "status_mismatch", objectId: p.stripe_payment_intent_id!, paymentId: p.id, details: `RouteVerde shows this payment as received; Stripe shows it as ${pi ? pi.status.replaceAll("_", " ") : "not found"}.` }));
    }
  }

  await s.refunds.list({ created: { gte: since }, limit: 100 }, opts).autoPagingEach(async (r: Stripe.Refund) => {
    if (++result.refunds > MAX_OBJECTS) return false;
    if (await withServiceRole((tx) => applyRefund(tx, tenantId, r, now))) result.fixed += 1;
  });

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

  result.issues = (await openIssues(tenantId)) - before;
  return result;
}

async function openIssues(tenantId: string): Promise<number> {
  const r = await withServiceRole((tx) => tx.selectFrom("reconciliation_issues").select((eb) => eb.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).where("resolved_at", "is", null).executeTakeFirstOrThrow());
  return Number(r.n);
}
