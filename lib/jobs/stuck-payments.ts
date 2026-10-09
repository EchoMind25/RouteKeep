import "server-only";
import { withServiceRole } from "@/lib/db/service";
import { AUTOPAY_STUCK_HOURS, PORTAL_STUCK_MINUTES, intentGivenUp, sessionVerdict, stuckKind, type StuckKind } from "@/lib/domain/payments";
import { requireStripe, type Stripe } from "@/lib/providers/payments";
import { applyCheckoutPayment, applyIntent, lockPayment, movePayment } from "./stripe-ledger";

// FR-BIL-07, G-05: payments that stayed pending because a webhook never came
// or the customer walked away. Part of the nightly reconciliation. Each row is
// its own transaction (the Stripe call happens outside it) and one bad row
// never stops the rest.

export const SWEEP_LIMIT = 200;

export interface SweepResult {
  checked: number;
  moved: number;
  errors: { paymentId: string; error: string }[];
}

export async function sweepStuckPayments(tenantId: string, account: string, now: Date, deadline = Infinity): Promise<SweepResult> {
  const s = requireStripe();
  const opts = { stripeAccount: account };
  const result: SweepResult = { checked: 0, moved: 0, errors: [] };
  const rows = await withServiceRole((tx) =>
    tx
      .selectFrom("payments")
      .select(["id", "source", "status", "created_at", "stripe_checkout_session_id", "stripe_payment_intent_id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "pending")
      .where((eb) =>
        eb.or([
          eb.and([eb("source", "=", "portal"), eb("created_at", "<", new Date(now.getTime() - PORTAL_STUCK_MINUTES * 60_000))]),
          eb.and([eb("source", "=", "autopay"), eb("stripe_payment_intent_id", "is not", null), eb("created_at", "<", new Date(now.getTime() - AUTOPAY_STUCK_HOURS * 3_600_000))]),
        ]),
      )
      .orderBy("created_at")
      .limit(SWEEP_LIMIT)
      .execute(),
  );
  for (const p of rows) {
    if (Date.now() > deadline) break;
    const kind = stuckKind({ source: p.source, status: "pending", createdAt: p.created_at, sessionId: p.stripe_checkout_session_id, intentId: p.stripe_payment_intent_id }, now);
    if (!kind) continue;
    result.checked += 1;
    try {
      if (await sweepOne(s, opts, tenantId, p, kind, now)) result.moved += 1;
    } catch (error) {
      result.errors.push({ paymentId: p.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

interface Row {
  id: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
}

async function sweepOne(s: Stripe, opts: { stripeAccount: string }, tenantId: string, p: Row, kind: StuckKind, now: Date): Promise<boolean> {
  if (kind === "portal-no-session") {
    return withServiceRole(async (tx) => {
      const payment = await lockPayment(tx, tenantId, { paymentId: p.id });
      if (!payment || !(await movePayment(tx, tenantId, payment, { to: "canceled", at: now }))) return false;
      await tx.updateTable("payments").set({ failure_message: "The payment page was never opened" }).where("tenant_id", "=", tenantId).where("id", "=", p.id).execute();
      return true;
    });
  }

  if (kind === "portal-session") {
    const session = await s.checkout.sessions.retrieve(p.stripe_checkout_session_id!, {}, opts);
    const verdict = sessionVerdict(session, now);
    if (verdict === "wait") return false;
    if (verdict === "canceled") return withServiceRole(async (tx) => (await applyCheckoutPayment(tx, tenantId, session, "expired", now)) ?? false);
    const intentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
    const pi = intentId ? await s.paymentIntents.retrieve(intentId, {}, opts) : null;
    return withServiceRole(async (tx) => {
      const applied = pi ? await applyIntent(tx, tenantId, pi, now) : null;
      if (applied) return applied.changed;
      return (await applyCheckoutPayment(tx, tenantId, session, "completed", now)) ?? false;
    });
  }

  // autopay-intent
  const pi = await s.paymentIntents.retrieve(p.stripe_payment_intent_id!, {}, opts);
  const applied = await withServiceRole((tx) => applyIntent(tx, tenantId, pi, now));
  if (applied?.changed || !intentGivenUp(pi.status)) return applied?.changed ?? false;
  // Still waiting on the customer after a day: stop it at Stripe so it cannot
  // be paid later, and let the retry schedule take over (FR-BIL-04).
  await s.paymentIntents.cancel(pi.id, {}, opts);
  return withServiceRole(async (tx) => {
    const payment = await lockPayment(tx, tenantId, { intentId: pi.id, paymentId: p.id });
    return payment ? movePayment(tx, tenantId, payment, { to: "failed", intentId: pi.id, failureCode: pi.status, at: now }) : false;
  });
}
