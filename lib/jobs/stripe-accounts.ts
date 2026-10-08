import "server-only";
import { withServiceRole } from "@/lib/db/service";
import type { Tx } from "@/lib/db/rls";
import { idempotency, methodLabel } from "@/lib/domain/payments";
import { requireStripe, type Stripe } from "@/lib/providers/payments";
import { enqueueEmail } from "@/lib/messaging/enqueue";

// M4 stage 2: connected accounts, Stripe customers and saved payment methods.
// Service role only; callers have already decided who may ask.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** D-09: what Stripe says about a business's account decides whether it can take payments. */
export async function syncAccount(tx: Tx, account: Stripe.Account): Promise<void> {
  await tx
    .updateTable("tenants")
    .set({ stripe_charges_enabled: account.charges_enabled === true, stripe_details_submitted: account.details_submitted === true })
    .where("stripe_account_id", "=", account.id)
    .execute();
}

export async function connectedAccount(tenantId: string): Promise<{ accountId: string; chargesEnabled: boolean } | null> {
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select(["stripe_account_id", "stripe_charges_enabled"]).where("id", "=", tenantId).executeTakeFirst());
  return t?.stripe_account_id ? { accountId: t.stripe_account_id, chargesEnabled: t.stripe_charges_enabled } : null;
}

/** The customer's Stripe customer on the business's account, made once (ENG-02). */
export async function ensureStripeCustomer(tenantId: string, customerId: string, accountId: string): Promise<string> {
  const c = await withServiceRole((tx) =>
    tx.selectFrom("customers").select(["stripe_customer_id", "email", "display_name"]).where("tenant_id", "=", tenantId).where("id", "=", customerId).executeTakeFirstOrThrow(),
  );
  if (c.stripe_customer_id) return c.stripe_customer_id;
  const created = await requireStripe().customers.create(
    { name: c.display_name, ...(c.email ? { email: c.email } : {}), metadata: { customer_id: customerId } },
    { stripeAccount: accountId, idempotencyKey: idempotency.customer(customerId) },
  );
  await withServiceRole((tx) =>
    tx.updateTable("customers").set({ stripe_customer_id: created.id }).where("tenant_id", "=", tenantId).where("id", "=", customerId).where("stripe_customer_id", "is", null).execute(),
  );
  return created.id;
}

/** CR-06: turns a method off. Open invoices stop being retried. Returns Stripe's id for the caller to detach. */
export async function revokeMethod(tx: Tx, tenantId: string, which: { stripePaymentMethodId?: string; customerId?: string }, by: "customer" | "office" | "stripe"): Promise<string | null> {
  let q = tx.updateTable("payment_methods").set({ status: "revoked", revoked_at: new Date(), revoked_by: by }).where("tenant_id", "=", tenantId).where("status", "=", "active");
  if (which.stripePaymentMethodId) q = q.where("stripe_payment_method_id", "=", which.stripePaymentMethodId);
  else if (which.customerId) q = q.where("customer_id", "=", which.customerId);
  else return null;
  const row = await q.returning(["customer_id", "stripe_payment_method_id"]).executeTakeFirst();
  if (!row) return null;
  await tx
    .updateTable("invoices")
    .set({ autopay_next_at: null })
    .where("tenant_id", "=", tenantId)
    .where("customer_id", "=", row.customer_id)
    .where("status", "=", "open")
    .where("autopay_next_at", "is not", null)
    .execute();
  return row.stripe_payment_method_id;
}

/** Best effort: Stripe forgets the method too. Our record already says revoked, so it is never charged either way. */
export async function detachQuietly(accountId: string, paymentMethodId: string): Promise<void> {
  try {
    await requireStripe().paymentMethods.detach(paymentMethodId, {}, { stripeAccount: accountId });
  } catch (error) {
    console.error(JSON.stringify({ msg: "detach failed", paymentMethodId, error: error instanceof Error ? error.message : String(error) }));
  }
}

/** FR-BIL-02: a finished autopay setup (Checkout in setup mode) becomes the customer's saved method. */
export async function saveSetupSession(tenantId: string, session: Stripe.Checkout.Session, accountId: string): Promise<void> {
  const id = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!id) return;
  const intent = await requireStripe().setupIntents.retrieve(id, { expand: ["payment_method"] }, { stripeAccount: accountId });
  await saveSetupIntent(tenantId, intent, accountId);
}

export async function saveSetupIntent(tenantId: string, intent: Stripe.SetupIntent, accountId: string): Promise<void> {
  // A bank account still being verified arrives again as setup_intent.succeeded.
  if (intent.status !== "succeeded") return;
  const customerId = intent.metadata?.customer_id;
  const consent = intent.metadata?.consent;
  const pm = intent.payment_method;
  if (!customerId || !UUID.test(customerId) || !consent || !pm || typeof pm === "string") return;
  if (pm.type !== "card" && pm.type !== "us_bank_account") return;
  const kind: "card" | "us_bank_account" = pm.type === "card" ? "card" : "us_bank_account";
  const mandate = typeof intent.mandate === "string" ? intent.mandate : (intent.mandate?.id ?? null);
  const replaced = await withServiceRole(async (tx) => {
    const exists = await tx.selectFrom("payment_methods").select("id").where("tenant_id", "=", tenantId).where("stripe_payment_method_id", "=", pm.id).executeTakeFirst();
    if (exists) return [];
    const old = await tx
      .updateTable("payment_methods")
      .set({ status: "replaced", revoked_at: new Date(), revoked_by: "customer" })
      .where("tenant_id", "=", tenantId)
      .where("customer_id", "=", customerId)
      .where("status", "=", "active")
      .returning("stripe_payment_method_id")
      .execute();
    const card = kind === "card" ? pm.card : null;
    const bank = kind === "us_bank_account" ? pm.us_bank_account : null;
    await tx
      .insertInto("payment_methods")
      .values({
        tenant_id: tenantId,
        customer_id: customerId,
        stripe_payment_method_id: pm.id,
        stripe_mandate_id: mandate,
        kind,
        label: methodLabel({ kind, brand: card?.brand, bankName: bank?.bank_name, last4: card?.last4 ?? bank?.last4 }),
        exp_month: card?.exp_month ?? null,
        exp_year: card?.exp_year ?? null,
        consent_text: consent,
        consented_at: new Date(intent.created * 1000),
      })
      .execute();
    // The office asked for autopay on the plan; now it is real.
    await tx.updateTable("subscriptions").set({ autopay: true }).where("tenant_id", "=", tenantId).where("customer_id", "=", customerId).where("status", "in", ["active", "paused"]).execute();
    await enqueueEmail(tx, { tenantId, topic: "autopay.enabled", key: pm.id, payload: { customerId, paymentMethodId: pm.id } });
    return old.map((o) => o.stripe_payment_method_id);
  });
  for (const old of replaced) await detachQuietly(accountId, old);
}
