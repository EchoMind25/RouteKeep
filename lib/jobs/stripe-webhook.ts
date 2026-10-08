import "server-only";
import { withServiceRole } from "@/lib/db/service";
import type { Tx } from "@/lib/db/rls";
import { requireStripe, type Stripe } from "@/lib/providers/payments";
import { applyCheckoutPayment, applyIntent, applyRefund, flagIssue, tenantForAccount } from "./stripe-ledger";
import { revokeMethod, saveSetupIntent, saveSetupSession, syncAccount } from "./stripe-accounts";

// ENG-03: Stripe's Connect events. The route has already checked the
// signature. Each event is written to webhook_events first; a delivery we
// have already processed is acknowledged and ignored, so retries and replays
// never act twice. Only what is needed to find the event again is stored,
// never customer details.

type Outcome = { outcome: "processed" | "duplicate" | "ignored"; tenantId: string | null };

const HANDLED = new Set([
  "account.updated",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "setup_intent.succeeded",
  "payment_method.detached",
  "mandate.updated",
  "charge.dispute.created",
]);

function brief(event: Stripe.Event) {
  const o = event.data.object as unknown as { id?: string; object?: string; status?: string };
  return { id: event.id, type: event.type, account: event.account ?? null, livemode: event.livemode, object: { id: o.id ?? null, object: o.object ?? null, status: o.status ?? null } };
}

export async function receiveStripeEvent(event: Stripe.Event): Promise<Outcome> {
  const claimed = await withServiceRole(async (tx) => {
    const tenantId = await tenantForAccount(tx, event.account);
    const row = await tx
      .insertInto("webhook_events")
      .values({ tenant_id: tenantId, provider: "stripe", event_id: event.id, type: event.type, payload: JSON.stringify(brief(event)) })
      .onConflict((oc) => oc.constraint("webhook_events_dedupe").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (row) return { id: row.id, tenantId };
    const seen = await tx.selectFrom("webhook_events").select(["id", "processed_at", "tenant_id"]).where("provider", "=", "stripe").where("event_id", "=", event.id).executeTakeFirstOrThrow();
    return seen.processed_at ? null : { id: seen.id, tenantId: seen.tenant_id };
  });
  if (!claimed) return { outcome: "duplicate", tenantId: null };

  // Platform events, other accounts' events and types we do not act on are kept and acknowledged.
  if (!claimed.tenantId || !HANDLED.has(event.type)) {
    await withServiceRole((tx) => tx.updateTable("webhook_events").set({ processed_at: new Date() }).where("id", "=", claimed.id).execute());
    return { outcome: "ignored", tenantId: null };
  }
  try {
    await handle(claimed.tenantId, event);
    await withServiceRole((tx) => tx.updateTable("webhook_events").set({ processed_at: new Date(), error: null }).where("id", "=", claimed.id).execute());
    return { outcome: "processed", tenantId: claimed.tenantId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    await withServiceRole((tx) => tx.updateTable("webhook_events").set({ error: message }).where("id", "=", claimed.id).execute());
    throw error;
  }
}

async function handle(tenantId: string, event: Stripe.Event): Promise<void> {
  const at = new Date(event.created * 1000);
  const run = <T>(fn: (tx: Tx) => Promise<T>) => withServiceRole(fn);
  switch (event.type) {
    case "account.updated":
      await run((tx) => syncAccount(tx, event.data.object));
      return;
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object;
      if (session.mode === "setup") {
        if (event.type === "checkout.session.completed") await saveSetupSession(tenantId, session, event.account!);
        return;
      }
      if (session.mode !== "payment") return;
      const kind = event.type === "checkout.session.completed" ? "completed" : event.type === "checkout.session.expired" ? "expired" : event.type === "checkout.session.async_payment_succeeded" ? "async_succeeded" : "async_failed";
      await run((tx) => applyCheckoutPayment(tx, tenantId, session, kind, at));
      return;
    }
    case "payment_intent.succeeded":
    case "payment_intent.processing":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      await run((tx) => applyIntent(tx, tenantId, event.data.object, at));
      return;
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      await run((tx) => applyRefund(tx, tenantId, event.data.object, at));
      return;
    case "setup_intent.succeeded": {
      // Bank accounts verified later (micro-deposits) finish here rather than in Checkout.
      const intent = await requireStripe().setupIntents.retrieve(event.data.object.id, { expand: ["payment_method"] }, { stripeAccount: event.account! });
      await saveSetupIntent(tenantId, intent, event.account!);
      return;
    }
    case "payment_method.detached":
      await run((tx) => revokeMethod(tx, tenantId, { stripePaymentMethodId: event.data.object.id }, "stripe"));
      return;
    case "mandate.updated": {
      const mandate = event.data.object;
      if (mandate.status === "inactive") {
        const pm = typeof mandate.payment_method === "string" ? mandate.payment_method : mandate.payment_method.id;
        await run((tx) => revokeMethod(tx, tenantId, { stripePaymentMethodId: pm }, "stripe"));
      }
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object;
      const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
      await run(async (tx) => {
        const payment = intentId ? await tx.selectFrom("payments").select("id").where("tenant_id", "=", tenantId).where("stripe_payment_intent_id", "=", intentId).executeTakeFirst() : undefined;
        await flagIssue(tx, tenantId, { kind: "dispute", objectId: dispute.id, paymentId: payment?.id ?? null, details: `The customer disputed a payment of ${dispute.amount} cents with their bank (${dispute.reason}). Answer it in your Stripe dashboard before the deadline.` });
      });
      return;
    }
    default:
      return;
  }
}
