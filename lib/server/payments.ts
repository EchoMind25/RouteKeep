import "server-only";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { withServiceRole } from "@/lib/db/service";
import { idempotency } from "@/lib/domain/payments";
import { env, stripeConfigured } from "@/lib/env";
import { detachQuietly, revokeMethod, syncAccount } from "@/lib/jobs/stripe-accounts";
import { applyRefund } from "@/lib/jobs/stripe-ledger";
import { requireStripe } from "@/lib/providers/payments";
import { BillingRefusedError } from "@/lib/server/billing";

// M4 stage 2, office side: connecting Stripe (D-09), autopay status and
// turning it off (CR-06), refunds (FR-BIL-06) and the reconciliation list
// (FR-BIL-07). Reads go through RLS as the member. Writes to Stripe fields
// run as service_role, always for the member's own tenant and only after the
// role check here.

const OWNERS = ["owner", "admin"] as const;

function allow(m: MemberSession, roles: readonly string[]) {
  if (!roles.includes(m.role)) throw new BillingRefusedError("Only the owner or an admin can do that.");
}

export interface PaymentsStatus {
  configured: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  reconciledAt: Date | null;
  issues: { id: string; kind: string; details: string; foundAt: Date; objectId: string; paymentId: string | null }[];
}

export async function paymentsStatus(m: MemberSession): Promise<PaymentsStatus> {
  const t = await withServiceRole((tx) =>
    tx.selectFrom("tenants").select(["stripe_account_id", "stripe_charges_enabled", "stripe_details_submitted", "stripe_reconciled_at"]).where("id", "=", m.tenantId).executeTakeFirstOrThrow(),
  );
  const issues = OWNERS.includes(m.role as (typeof OWNERS)[number])
    ? await withRls(m.claims, (tx) =>
        tx.selectFrom("reconciliation_issues").select(["id", "kind", "details", "found_at", "stripe_object_id", "payment_id"]).where("resolved_at", "is", null).orderBy("found_at", "desc").limit(100).execute(),
      )
    : [];
  return {
    configured: stripeConfigured(),
    accountId: t.stripe_account_id,
    chargesEnabled: t.stripe_charges_enabled,
    detailsSubmitted: t.stripe_details_submitted,
    reconciledAt: t.stripe_reconciled_at,
    issues: issues.map((i) => ({ id: i.id, kind: i.kind, details: i.details, foundAt: i.found_at, objectId: i.stripe_object_id, paymentId: i.payment_id })),
  };
}

/** D-09: the owner connects the business's own Stripe account (Standard). Returns Stripe's onboarding page. */
export async function startStripeOnboarding(m: MemberSession): Promise<string> {
  if (m.role !== "owner") throw new BillingRefusedError("Only the owner can connect the business's Stripe account.");
  const s = requireStripe();
  let accountId = (await withServiceRole((tx) => tx.selectFrom("tenants").select("stripe_account_id").where("id", "=", m.tenantId).executeTakeFirstOrThrow())).stripe_account_id;
  if (!accountId) {
    const account = await s.accounts.create(
      { type: "standard", business_profile: { name: m.tenantName }, metadata: { tenant_id: m.tenantId } },
      { idempotencyKey: idempotency.account(m.tenantId) },
    );
    await withServiceRole((tx) => tx.updateTable("tenants").set({ stripe_account_id: account.id }).where("id", "=", m.tenantId).where("stripe_account_id", "is", null).execute());
    // Two clicks at once share the idempotency key, so this is the same account either way.
    accountId = account.id;
  }
  const base = `${env().APP_URL}/settings/payments`;
  const link = await s.accountLinks.create({ account: accountId, type: "account_onboarding", refresh_url: `${base}?refresh=1`, return_url: `${base}?return=1` });
  return link.url;
}

/** Asks Stripe where the account stands now (on return from onboarding, or the "Check again" button). */
export async function refreshStripeStatus(m: MemberSession): Promise<void> {
  allow(m, OWNERS);
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select("stripe_account_id").where("id", "=", m.tenantId).executeTakeFirstOrThrow());
  if (!t.stripe_account_id) return;
  const account = await requireStripe().accounts.retrieve(t.stripe_account_id);
  await withServiceRole((tx) => syncAccount(tx, account));
}

export async function resolveIssue(m: MemberSession, id: string): Promise<void> {
  allow(m, OWNERS);
  await withRls(m.claims, (tx) => tx.updateTable("reconciliation_issues").set({ resolved_at: new Date(), resolved_by: m.userId }).where("id", "=", id).where("resolved_at", "is", null).execute());
}

export interface AutopayStatus {
  label: string;
  since: Date;
  kind: string;
}

export async function customerAutopay(m: MemberSession, customerId: string): Promise<AutopayStatus | null> {
  const r = await withRls(m.claims, (tx) =>
    tx.selectFrom("payment_methods").select(["label", "consented_at", "kind"]).where("customer_id", "=", customerId).where("status", "=", "active").executeTakeFirst(),
  );
  return r ? { label: r.label, since: r.consented_at, kind: r.kind } : null;
}

/** CR-06: the office turns autopay off for a customer (say, they called to ask). */
export async function turnOffAutopayForCustomer(m: MemberSession, customerId: string): Promise<void> {
  allow(m, ["owner", "admin", "office"]);
  // Visible to this member, so it is theirs to change.
  const visible = await customerAutopay(m, customerId);
  if (!visible) return;
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select("stripe_account_id").where("id", "=", m.tenantId).executeTakeFirstOrThrow());
  const pm = await withServiceRole((tx) => revokeMethod(tx, m.tenantId, { customerId }, "office"));
  if (pm && t.stripe_account_id) await detachQuietly(t.stripe_account_id, pm);
}

export interface OnlinePayment {
  id: string;
  method: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  failure: string | null;
  createdAt: Date;
  receivedAt: Date | null;
  refundable: boolean;
}

/** The card and bank payments on an invoice, including ones still on their way or declined. */
export async function onlinePayments(m: MemberSession, invoiceId: string): Promise<OnlinePayment[]> {
  const rows = await withRls(m.claims, (tx) =>
    tx
      .selectFrom("payments")
      .select(["id", "method", "status", "amount_cents", "refunded_cents", "failure_message", "created_at", "received_at", "stripe_payment_intent_id"])
      .where("invoice_id", "=", invoiceId)
      .where("method", "in", ["card", "ach", "card_on_file"])
      .where("status", "!=", "pending")
      .orderBy("created_at", "desc")
      .execute(),
  );
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    status: r.status,
    amountCents: r.amount_cents,
    refundedCents: r.refunded_cents,
    failure: r.failure_message,
    createdAt: r.created_at,
    receivedAt: r.received_at,
    refundable: r.status === "succeeded" && r.stripe_payment_intent_id !== null && r.refunded_cents < r.amount_cents,
  }));
}

/**
 * FR-BIL-06: money back to the customer's card or bank. The refund is a
 * ledger entry; with `credit`, a matching credit keeps the invoice settled
 * (the usual case: the service is being made good). Without it, the customer
 * owes the amount again.
 */
export async function refundPayment(m: MemberSession, input: { paymentId: string; key: string; amountCents: number; reason: string; credit: boolean }): Promise<"done" | "pending"> {
  allow(m, OWNERS);
  const p = await withRls(m.claims, (tx) =>
    tx.selectFrom("payments").select(["id", "status", "amount_cents", "refunded_cents", "stripe_payment_intent_id"]).where("id", "=", input.paymentId).executeTakeFirst(),
  );
  if (!p || p.status !== "succeeded" || !p.stripe_payment_intent_id) throw new BillingRefusedError("Only a card or bank payment that went through can be refunded here.");
  if (input.amountCents > p.amount_cents - p.refunded_cents) throw new BillingRefusedError("That is more than is left to refund on this payment.");
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select("stripe_account_id").where("id", "=", m.tenantId).executeTakeFirstOrThrow());
  if (!t.stripe_account_id) throw new BillingRefusedError("Stripe is not connected.");
  const refund = await requireStripe().refunds.create(
    { payment_intent: p.stripe_payment_intent_id, amount: input.amountCents, metadata: { payment_id: p.id, reason: input.reason.slice(0, 200), credit: input.credit ? "1" : "0" } },
    { stripeAccount: t.stripe_account_id, idempotencyKey: idempotency.refund(p.id, input.key) },
  );
  // A card refund is final at once; a bank refund posts when Stripe's event says it went through.
  const posted = await withServiceRole((tx) => applyRefund(tx, m.tenantId, refund));
  return posted || refund.status === "succeeded" ? "done" : "pending";
}
