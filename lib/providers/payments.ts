import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

// D-09: Stripe Connect with Standard connected accounts and direct charges.
// Every call that touches a business's money runs on that business's connected
// account (`stripeAccount`) and carries an idempotency key derived from our
// row id (ENG-02). Card and bank numbers only ever go into Stripe's own pages
// (CR-05). Without STRIPE_SECRET_KEY there is no client and online payment is
// simply not offered.

export { Stripe };

let client: Stripe | null | undefined;

export function stripe(): Stripe | null {
  if (client !== undefined) return client;
  const e = env();
  if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET) return (client = null);
  const base = e.STRIPE_API_BASE ? new URL(e.STRIPE_API_BASE) : null;
  client = new Stripe(e.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    // D-04: a Stripe call is one part of a step that must finish inside 20 s.
    timeout: 10_000,
    appInfo: { name: "RouteVerde" },
    ...(base ? { host: base.hostname, port: base.port || (base.protocol === "https:" ? 443 : 80), protocol: base.protocol === "https:" ? "https" : "http" } : {}),
  });
  return client;
}

export function requireStripe(): Stripe {
  const s = stripe();
  if (!s) throw new Error("Stripe is not set up (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET)");
  return s;
}

/** ENG-03: the event, only if Stripe signed it with our endpoint's secret. Throws otherwise. */
export function verifyStripeEvent(payload: string, signature: string | null): Stripe.Event {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) throw new Error("Missing signature");
  return requireStripe().webhooks.constructEvent(payload, signature, secret);
}

/** The decline code of a failed Stripe call, when it was a card or bank refusal or another final answer. */
export function declineOf(error: unknown): { code: string | null; declined: boolean } {
  if (error instanceof Stripe.errors.StripeCardError) return { code: error.decline_code ?? error.code ?? null, declined: true };
  if (error instanceof Stripe.errors.StripeError && error.type === "StripeInvalidRequestError" && error.code === "authentication_required") return { code: "authentication_required", declined: true };
  // FR-BIL-04: a request Stripe refuses as invalid (the card was detached, the
  // customer is gone) or an idempotency clash fails the same way every time,
  // so it is final too and the retry schedule takes over. Only connection,
  // API and rate-limit trouble is worth repeating as is.
  if (error instanceof Stripe.errors.StripeInvalidRequestError || error instanceof Stripe.errors.StripeIdempotencyError) return { code: error.code ?? error.type, declined: true };
  return { code: null, declined: false };
}
