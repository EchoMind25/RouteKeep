import "server-only";
import { withPortal, type PortalClaims } from "@/lib/db/rls";
import { withServiceRole } from "@/lib/db/service";
import { autopayConsent, idempotency } from "@/lib/domain/payments";
import { env, stripeConfigured } from "@/lib/env";
import { detachQuietly, ensureStripeCustomer, revokeMethod } from "@/lib/jobs/stripe-accounts";
import { requireStripe } from "@/lib/providers/payments";

// FR-POR-02, FR-BIL-02, CR-05, CR-06: paying an invoice and autopay from the
// customer portal. What the customer may touch is decided by reading through
// the portal role (the database limits it to their own rows); only then does
// server code write, as service_role, for exactly that tenant and customer.
// Card and bank details are typed only into Stripe's own pages.

export const PAY_ERRORS = {
  unavailable: "Paying online isn't available right now. Please call the office.",
  not_found: "That invoice isn't on your account.",
  paid: "That invoice is already paid.",
  too_small: "The amount left is too small to pay by card. Please call the office.",
  on_the_way: "A bank payment for this invoice is already on its way. It can take a few business days to clear.",
  closed: "That payment page has closed. Try again.",
  just_paid: "A payment for this invoice just went through. It shows here in a moment.",
  in_progress: "A payment for this invoice is already being made. Refresh in a minute to see it.",
  stripe: "Stripe didn't open the page. Please try again in a minute.",
} as const;

export type PayErrorCode = keyof typeof PAY_ERRORS;

export class PortalPaymentError extends Error {
  override name = "PortalPaymentError";
  constructor(readonly code: PayErrorCode) {
    super(PAY_ERRORS[code]);
  }
}

export interface PortalPayments {
  online: boolean;
  autopay: { label: string; since: Date; consent: string } | null;
  consentText: string;
  /** Invoices with a bank payment on its way, so they are not paid twice. */
  processing: string[];
}

export async function portalPayments(claims: PortalClaims): Promise<PortalPayments> {
  return withPortal(claims, async (tx) => {
    const t = await tx.selectFrom("tenants").select(["name", "stripe_charges_enabled"]).executeTakeFirstOrThrow();
    const m = await tx.selectFrom("payment_methods").select(["label", "consented_at", "consent_text"]).where("status", "=", "active").executeTakeFirst();
    const processing = await tx.selectFrom("payments").select("invoice_id").where("status", "=", "processing").where("invoice_id", "is not", null).execute();
    return {
      online: stripeConfigured() && t.stripe_charges_enabled,
      autopay: m ? { label: m.label, since: m.consented_at, consent: m.consent_text } : null,
      consentText: autopayConsent(t.name),
      processing: processing.map((p) => p.invoice_id!),
    };
  });
}

async function account(tenantId: string): Promise<string> {
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select(["stripe_account_id", "stripe_charges_enabled"]).where("id", "=", tenantId).executeTakeFirstOrThrow());
  if (!stripeConfigured() || !t.stripe_account_id || !t.stripe_charges_enabled) throw new PortalPaymentError("unavailable");
  return t.stripe_account_id;
}

const portalUrl = (tenantId: string) => `${env().APP_URL}/p/${tenantId}`;

/** FR-POR-02: Stripe's checkout page for what is left on one invoice. Returns its address. */
export async function payInvoice(claims: PortalClaims, invoiceId: string, key: string): Promise<string> {
  const tenantId = claims.portal_tenant_id;
  const customerId = claims.portal_customer_id;
  const inv = await withPortal(claims, async (tx) => {
    const i = await tx
      .selectFrom("invoices as i")
      .innerJoin("invoice_balances as b", (j) => j.onRef("b.invoice_id", "=", "i.id").onRef("b.tenant_id", "=", "i.tenant_id"))
      .select(["i.id", "i.number", "i.status", "b.open_cents"])
      .where("i.id", "=", invoiceId)
      .executeTakeFirst();
    const onTheWay = await tx.selectFrom("payments").select("id").where("invoice_id", "=", invoiceId).where("status", "=", "processing").executeTakeFirst();
    return i ? { ...i, open: Number(i.open_cents ?? 0), onTheWay: Boolean(onTheWay) } : null;
  });
  if (!inv) throw new PortalPaymentError("not_found");
  if (inv.status !== "open" || inv.open <= 0) throw new PortalPaymentError("paid");
  // Stripe's smallest card charge.
  if (inv.open < 50) throw new PortalPaymentError("too_small");
  if (inv.onTheWay) throw new PortalPaymentError("on_the_way");
  const acct = await account(tenantId);
  const s = requireStripe();

  // ENG-01: the same click (same key) reuses its page instead of opening a second one.
  const existing = await withServiceRole((tx) =>
    tx.selectFrom("payments").select(["id", "status", "stripe_checkout_session_id"]).where("tenant_id", "=", tenantId).where("customer_id", "=", customerId).where("client_payment_key", "=", key).executeTakeFirst(),
  );
  if (existing?.stripe_checkout_session_id) {
    const session = await s.checkout.sessions.retrieve(existing.stripe_checkout_session_id, {}, { stripeAccount: acct });
    if (session.status === "open" && session.url) return session.url;
    throw new PortalPaymentError("closed");
  }

  // Only one open checkout page per invoice, so it cannot be paid twice from two tabs.
  const older = await withServiceRole((tx) =>
    tx
      .selectFrom("payments")
      .select(["id", "stripe_checkout_session_id"])
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", inv.id)
      .where("status", "=", "pending")
      .where("source", "=", "portal")
      .where("stripe_checkout_session_id", "is not", null)
      .execute(),
  );
  // A row whose page was never created (Stripe failed after the insert) is
  // dead weight once it is a few minutes old; left pending it would block
  // autopay and every later attempt.
  await withServiceRole((tx) =>
    tx
      .updateTable("payments")
      .set({ status: "canceled", failure_message: "The payment page was never opened" })
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", inv.id)
      .where("status", "=", "pending")
      .where("source", "=", "portal")
      .where("stripe_checkout_session_id", "is", null)
      .where("created_at", "<", new Date(Date.now() - 5 * 60_000))
      .execute(),
  );
  for (const o of older) {
    const session = await s.checkout.sessions.retrieve(o.stripe_checkout_session_id!, {}, { stripeAccount: acct });
    if (session.status === "complete") throw new PortalPaymentError("just_paid");
    if (session.status === "open") await s.checkout.sessions.expire(session.id, {}, { stripeAccount: acct });
    await withServiceRole((tx) => tx.updateTable("payments").set({ status: "canceled" }).where("tenant_id", "=", tenantId).where("id", "=", o.id).where("status", "=", "pending").execute());
  }

  const stripeCustomer = await ensureStripeCustomer(tenantId, customerId, acct);
  // The check and the insert share one transaction behind the invoice's row
  // lock, so two tabs (or a double click) cannot both get a page, and a card
  // or bank payment already in flight from autopay is not doubled (G-05).
  const payment = existing ?? (await withServiceRole(async (tx) => {
    await tx.selectFrom("invoices").select("id").where("tenant_id", "=", tenantId).where("id", "=", inv.id).forUpdate().executeTakeFirstOrThrow();
    const rival = await tx
      .selectFrom("payments")
      .select("status")
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", inv.id)
      .where("status", "in", ["pending", "processing"])
      .where("method", "in", ["card", "ach", "card_on_file"])
      .executeTakeFirst();
    if (rival) throw new PortalPaymentError(rival.status === "processing" ? "on_the_way" : "in_progress");
    return tx
      .insertInto("payments")
      .values({ tenant_id: tenantId, customer_id: customerId, invoice_id: inv.id, client_payment_key: key, method: "card", status: "pending", amount_cents: inv.open, source: "portal", collected_by: null })
      .returning(["id", "status", "stripe_checkout_session_id"])
      .executeTakeFirstOrThrow();
  }));
  const base = portalUrl(tenantId);
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      customer: stripeCustomer,
      client_reference_id: payment.id,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: inv.open, product_data: { name: `Invoice ${inv.number}` } } }],
      payment_intent_data: { description: `Invoice ${inv.number}`, metadata: { payment_id: payment.id, invoice_id: inv.id, source: "portal" } },
      metadata: { payment_id: payment.id, invoice_id: inv.id },
      // The shortest Stripe allows, so an abandoned page closes soon.
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
      success_url: `${base}?paid=${inv.id}`,
      cancel_url: base,
    },
    { stripeAccount: acct, idempotencyKey: idempotency.checkout(payment.id) },
  );
  await withServiceRole((tx) => tx.updateTable("payments").set({ stripe_checkout_session_id: session.id }).where("tenant_id", "=", tenantId).where("id", "=", payment.id).execute());
  if (!session.url) throw new PortalPaymentError("stripe");
  return session.url;
}

/** FR-BIL-02, CR-06: Stripe's page to save a card or bank account for autopay, showing what the customer agrees to. */
export async function setUpAutopay(claims: PortalClaims, key: string): Promise<string> {
  const tenantId = claims.portal_tenant_id;
  const customerId = claims.portal_customer_id;
  const name = await withPortal(claims, async (tx) => (await tx.selectFrom("tenants").select("name").executeTakeFirstOrThrow()).name);
  const acct = await account(tenantId);
  const stripeCustomer = await ensureStripeCustomer(tenantId, customerId, acct);
  const consent = autopayConsent(name);
  const base = portalUrl(tenantId);
  const session = await requireStripe().checkout.sessions.create(
    {
      mode: "setup",
      currency: "usd",
      customer: stripeCustomer,
      setup_intent_data: { metadata: { customer_id: customerId, consent } },
      metadata: { customer_id: customerId, purpose: "autopay" },
      custom_text: { submit: { message: consent } },
      success_url: `${base}?autopay=1`,
      cancel_url: base,
    },
    { stripeAccount: acct, idempotencyKey: idempotency.setup(customerId, key) },
  );
  if (!session.url) throw new PortalPaymentError("stripe");
  return session.url;
}

/** CR-06: the customer turns autopay off. Takes effect at once; nothing more is charged. */
export async function turnOffAutopay(claims: PortalClaims): Promise<void> {
  const tenantId = claims.portal_tenant_id;
  const pm = await withServiceRole((tx) => revokeMethod(tx, tenantId, { customerId: claims.portal_customer_id }, "customer"));
  const t = await withServiceRole((tx) => tx.selectFrom("tenants").select("stripe_account_id").where("id", "=", tenantId).executeTakeFirstOrThrow());
  if (pm && t.stripe_account_id) await detachQuietly(t.stripe_account_id, pm);
}
