import { PRIVATE } from "@/lib/auth/api";
import { receiveStripeEvent } from "@/lib/jobs/stripe-webhook";
import { kickOutbox } from "@/lib/messaging/kick";
import { stripe, verifyStripeEvent } from "@/lib/providers/payments";

// ENG-03: Stripe's Connect webhook. The signature is checked against the raw
// body before anything else; an unsigned or tampered request gets a 400 and
// touches nothing. A 500 makes Stripe retry, which is safe: events are
// deduplicated on their id and every effect is idempotent.
export async function POST(request: Request) {
  if (!stripe()) return new Response(null, { status: 404, headers: PRIVATE });
  const body = await request.text();
  let event;
  try {
    event = verifyStripeEvent(body, request.headers.get("stripe-signature"));
  } catch {
    return new Response("Bad signature", { status: 400, headers: PRIVATE });
  }
  try {
    const { outcome, tenantId } = await receiveStripeEvent(event);
    // Receipts and notices it queued go out after the response.
    if (tenantId) kickOutbox(tenantId);
    return Response.json({ received: true, outcome }, { headers: PRIVATE });
  } catch (error) {
    console.error(JSON.stringify({ msg: "stripe webhook failed", event: event.id, type: event.type, error: error instanceof Error ? error.message : String(error) }));
    return new Response("Not processed", { status: 500, headers: PRIVATE });
  }
}
