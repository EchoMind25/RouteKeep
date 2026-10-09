import "server-only";
import { sql } from "kysely";
import type { Tx } from "@/lib/db/rls";
import { canMove, declineText, needsNewMethod, nextAutopayAttempt, takenButNotOurs, type PaymentStatus } from "@/lib/domain/payments";
import type { Stripe } from "@/lib/providers/payments";
import { enqueueEmail } from "@/lib/messaging/enqueue";
import { settleInvoice } from "@/lib/server/billing-run";

// M4 stage 2: how Stripe's answers become our records. Shared by the webhook
// (ENG-03), the autopay run and the nightly reconciliation (FR-BIL-07), so a
// payment ends up the same whichever of them hears about it first. Everything
// runs as service_role inside the caller's transaction, names the tenant
// outright, and is idempotent: status only moves forward (canMove), ledger
// entries are keyed (ENG-06), emails are keyed (ENG-04).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function tenantForAccount(tx: Tx, accountId: string | null | undefined): Promise<string | null> {
  if (!accountId) return null;
  return (await tx.selectFrom("tenants").select("id").where("stripe_account_id", "=", accountId).executeTakeFirst())?.id ?? null;
}

export interface PaymentRow {
  id: string;
  customer_id: string;
  invoice_id: string | null;
  status: PaymentStatus;
  amount_cents: number;
  method: string;
  source: string;
  stripe_payment_intent_id: string | null;
}

export async function lockPayment(tx: Tx, tenantId: string, by: { intentId?: string | null; paymentId?: string | null; sessionId?: string | null }): Promise<PaymentRow | null> {
  const base = () =>
    tx
      .selectFrom("payments")
      .select(["id", "customer_id", "invoice_id", "status", "amount_cents", "method", "source", "stripe_payment_intent_id"])
      .where("tenant_id", "=", tenantId)
      .forUpdate();
  if (by.intentId) {
    const row = await base().where("stripe_payment_intent_id", "=", by.intentId).executeTakeFirst();
    if (row) return row as PaymentRow;
  }
  if (by.sessionId) {
    const row = await base().where("stripe_checkout_session_id", "=", by.sessionId).executeTakeFirst();
    if (row) return row as PaymentRow;
  }
  if (by.paymentId && UUID.test(by.paymentId)) {
    const row = await base().where("id", "=", by.paymentId).executeTakeFirst();
    // A payment already tied to another intent is not this one.
    if (row && (!row.stripe_payment_intent_id || row.stripe_payment_intent_id === by.intentId)) return row as PaymentRow;
  }
  return null;
}

export async function flagIssue(tx: Tx, tenantId: string, issue: { kind: "amount_mismatch" | "unknown_payment" | "status_mismatch" | "refund_failed" | "dispute"; objectId: string; paymentId?: string | null; details: string }) {
  await tx
    .insertInto("reconciliation_issues")
    .values({ tenant_id: tenantId, kind: issue.kind, stripe_object_id: issue.objectId, payment_id: issue.paymentId ?? null, details: issue.details.slice(0, 500) })
    .onConflict((oc) => oc.constraint("reconciliation_issue_key").doNothing())
    .execute();
}

export interface Move {
  to: PaymentStatus;
  intentId?: string | null;
  /** What Stripe actually took, for a success. */
  amountReceived?: number;
  /** "ach" when the customer paid by bank in Checkout. */
  method?: "card" | "ach" | "card_on_file";
  failureCode?: string | null;
  at: Date;
}

/** Moves one payment to what Stripe says, posting the ledger, receipt and retry schedule that go with it. */
export async function movePayment(tx: Tx, tenantId: string, payment: PaymentRow, move: Move): Promise<boolean> {
  if (move.intentId && !payment.stripe_payment_intent_id) {
    await tx.updateTable("payments").set({ stripe_payment_intent_id: move.intentId }).where("tenant_id", "=", tenantId).where("id", "=", payment.id).execute();
  }
  if (takenButNotOurs(payment.status, move.to)) {
    // FR-BIL-07: Stripe took the money but our row says otherwise. Not posted to
    // the ledger on a guess; the office decides.
    const intentId = move.intentId ?? payment.stripe_payment_intent_id ?? payment.id;
    await flagIssue(tx, tenantId, { kind: "status_mismatch", objectId: intentId, paymentId: payment.id, details: `Stripe took this payment (${intentId}) but RouteKeep has it as ${payment.status}. Nothing was posted to the ledger; check it and record the payment by hand if it is right.` });
    return false;
  }
  if (!canMove(payment.status, move.to)) return false;

  if (move.to === "succeeded") {
    const amount = move.amountReceived ?? payment.amount_cents;
    if (amount !== payment.amount_cents) {
      await flagIssue(tx, tenantId, { kind: "amount_mismatch", objectId: move.intentId ?? payment.stripe_payment_intent_id ?? payment.id, paymentId: payment.id, details: `Stripe took ${amount} cents; the payment was for ${payment.amount_cents}. The ledger shows what Stripe took.` });
    }
    await tx
      .updateTable("payments")
      .set({ status: "succeeded", received_at: move.at, failure_code: null, failure_message: null, ...(move.method ? { method: move.method } : {}) })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", payment.id)
      .execute();
    if (amount > 0) {
      await tx
        .insertInto("ledger_entries")
        .values({ tenant_id: tenantId, customer_id: payment.customer_id, type: "payment", amount_cents: -amount, payment_id: payment.id, invoice_id: payment.invoice_id, entry_key: `payment:${payment.id}`, occurred_at: move.at, source: "stripe" })
        .onConflict((oc) => oc.constraint("ledger_entry_key").doNothing())
        .execute();
    }
    // FR-BIL-05: the receipt.
    await enqueueEmail(tx, { tenantId, topic: "payment.received", key: payment.id, payload: { paymentId: payment.id } });
    if (payment.invoice_id) {
      await settleInvoice(tx, payment.invoice_id, move.at);
      await tx.updateTable("invoices").set({ autopay_next_at: null, autopay_last_error: null }).where("tenant_id", "=", tenantId).where("id", "=", payment.invoice_id).where("status", "=", "paid").execute();
    }
    return true;
  }

  if (move.to === "failed") {
    const reason = declineText(move.failureCode);
    await tx
      .updateTable("payments")
      .set({ status: "failed", failure_code: move.failureCode ?? null, failure_message: reason })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", payment.id)
      .execute();
    let retryAt: Date | null = null;
    if (payment.invoice_id && payment.source === "autopay") {
      // FR-BIL-04: the next try, or none and the invoice waits in collections.
      const inv = await tx.selectFrom("invoices").select(["autopay_attempts", "status"]).where("tenant_id", "=", tenantId).where("id", "=", payment.invoice_id).forUpdate().executeTakeFirstOrThrow();
      retryAt = inv.status === "open" ? nextAutopayAttempt(inv.autopay_attempts, move.at) : null;
      await tx.updateTable("invoices").set({ autopay_next_at: retryAt, autopay_last_error: reason }).where("tenant_id", "=", tenantId).where("id", "=", payment.invoice_id).execute();
    }
    // FR-BIL-04: the customer hears about it, with a way to pay or update their card.
    await enqueueEmail(tx, {
      tenantId,
      topic: "payment.failed",
      key: payment.id,
      payload: { paymentId: payment.id, retryAt: retryAt?.toISOString() ?? null, newMethod: needsNewMethod(move.failureCode) },
    });
    return true;
  }

  await tx
    .updateTable("payments")
    .set({ status: move.to, ...(move.method ? { method: move.method } : {}) })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", payment.id)
    .execute();
  return true;
}

function methodOf(pi: Stripe.PaymentIntent): Move["method"] {
  const pm = pi.payment_method;
  const type = pm && typeof pm === "object" ? pm.type : (pi.payment_method_types?.length === 1 ? pi.payment_method_types[0] : undefined);
  return type === "us_bank_account" ? "ach" : undefined;
}

/**
 * A PaymentIntent as Stripe reports it. A failure counts only for autopay:
 * a card declined inside Checkout leaves the customer on Stripe's page to try
 * another, so that payment is decided by the Checkout session instead.
 */
export async function applyIntent(tx: Tx, tenantId: string, pi: Stripe.PaymentIntent, at: Date = new Date()): Promise<{ paymentId: string; changed: boolean } | null> {
  const payment = await lockPayment(tx, tenantId, { intentId: pi.id, paymentId: pi.metadata?.payment_id });
  if (!payment) {
    // Ours (it carries our payment id) but not on file: someone should look.
    if (pi.metadata?.payment_id && pi.status === "succeeded") {
      await flagIssue(tx, tenantId, { kind: "unknown_payment", objectId: pi.id, details: `Stripe took ${pi.amount_received} cents for a payment RouteVerde has no record of.` });
    }
    return null;
  }
  const autopay = payment.source === "autopay";
  const err = pi.last_payment_error;
  const move: Move | null =
    pi.status === "succeeded"
      ? { to: "succeeded", intentId: pi.id, amountReceived: pi.amount_received, method: methodOf(pi) ?? (autopay ? undefined : "card"), at }
      : pi.status === "processing"
        ? { to: "processing", intentId: pi.id, method: methodOf(pi), at }
        : pi.status === "canceled"
          ? { to: autopay ? "failed" : "canceled", intentId: pi.id, failureCode: "canceled", at }
          : pi.status === "requires_payment_method" && err && autopay
            ? { to: "failed", intentId: pi.id, failureCode: err.decline_code ?? err.code ?? null, at }
            : null;
  if (!move) {
    if (!payment.stripe_payment_intent_id) await tx.updateTable("payments").set({ stripe_payment_intent_id: pi.id }).where("tenant_id", "=", tenantId).where("id", "=", payment.id).execute();
    return { paymentId: payment.id, changed: false };
  }
  return { paymentId: payment.id, changed: await movePayment(tx, tenantId, payment, move) };
}

/** A Checkout session for an invoice: completed (paid, or a bank payment on its way), failed later, or expired. */
export async function applyCheckoutPayment(tx: Tx, tenantId: string, session: Stripe.Checkout.Session, kind: "completed" | "async_succeeded" | "async_failed" | "expired", at: Date = new Date()) {
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const payment = await lockPayment(tx, tenantId, { sessionId: session.id, intentId, paymentId: session.metadata?.payment_id });
  if (!payment) return null;
  const move: Move | null =
    kind === "expired"
      ? { to: "canceled", at }
      : kind === "async_failed"
        ? { to: "failed", intentId, failureCode: "bank_declined", at }
        : session.payment_status === "paid"
          ? { to: "succeeded", intentId, amountReceived: session.amount_total ?? undefined, at }
          : { to: "processing", intentId, method: "ach", at };
  return movePayment(tx, tenantId, payment, move);
}

/** FR-BIL-06: a refund is a ledger entry; the payment's refunded total follows the ledger. Credits the invoice too when the office asked. */
export async function applyRefund(tx: Tx, tenantId: string, refund: Stripe.Refund, at: Date = new Date()): Promise<boolean> {
  const intentId = typeof refund.payment_intent === "string" ? refund.payment_intent : (refund.payment_intent?.id ?? null);
  if (!intentId) return false;
  const payment = await lockPayment(tx, tenantId, { intentId });
  if (!payment) return false;
  if (refund.status === "failed" || refund.status === "canceled") {
    const posted = await tx.selectFrom("ledger_entries").select("id").where("tenant_id", "=", tenantId).where("entry_key", "=", `refund:${refund.id}`).executeTakeFirst();
    if (posted) await flagIssue(tx, tenantId, { kind: "refund_failed", objectId: refund.id, paymentId: payment.id, details: `A refund of ${refund.amount} cents was recorded but Stripe says it ${refund.status === "failed" ? "failed" : "was canceled"}. The customer did not get this money back.` });
    return false;
  }
  if (refund.status !== "succeeded") return false;
  const inserted = await tx
    .insertInto("ledger_entries")
    .values({ tenant_id: tenantId, customer_id: payment.customer_id, type: "refund", amount_cents: refund.amount, payment_id: payment.id, invoice_id: payment.invoice_id, entry_key: `refund:${refund.id}`, memo: refund.metadata?.reason || null, occurred_at: at, source: "stripe" })
    .onConflict((oc) => oc.constraint("ledger_entry_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) return false;
  if (refund.metadata?.credit === "1") {
    await tx
      .insertInto("ledger_entries")
      .values({ tenant_id: tenantId, customer_id: payment.customer_id, type: "credit", amount_cents: -refund.amount, invoice_id: payment.invoice_id, entry_key: `refund-credit:${refund.id}`, memo: refund.metadata?.reason ? `Refunded: ${refund.metadata.reason}` : "Refunded", occurred_at: at, source: "stripe" })
      .onConflict((oc) => oc.constraint("ledger_entry_key").doNothing())
      .execute();
  }
  await sql`update public.payments p set refunded_cents = least(p.amount_cents, coalesce((select sum(e.amount_cents) from public.ledger_entries e where e.tenant_id = p.tenant_id and e.payment_id = p.id and e.type = 'refund'), 0))
    where p.tenant_id = ${tenantId}::uuid and p.id = ${payment.id}::uuid`.execute(tx);
  // Money went back and nothing took it off the invoice: the customer owes it again.
  if (payment.invoice_id) {
    await sql`update public.invoices i set status = 'open', paid_at = null
      where i.tenant_id = ${tenantId}::uuid and i.id = ${payment.invoice_id}::uuid and i.status = 'paid'
        and (select b.open_cents from public.invoice_balances b where b.tenant_id = i.tenant_id and b.invoice_id = i.id) > 0`.execute(tx);
  }
  return true;
}
