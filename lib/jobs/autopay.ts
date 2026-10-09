import "server-only";
import { after } from "next/server";
import { withServiceRole } from "@/lib/db/service";
import { AUTOPAY_MAX_ATTEMPTS, idempotency } from "@/lib/domain/payments";
import { declineOf, requireStripe, stripe } from "@/lib/providers/payments";
import { processOutbox } from "./outbox";
import { applyIntent, movePayment } from "./stripe-ledger";
import { errorText, log } from "@/lib/observability/log";

// FR-BIL-02, FR-BIL-04: autopay. An invoice for a customer with an active
// saved method is due for a charge when it is issued (autopay_next_at); a
// failed try moves autopay_next_at out by the retry schedule. Each charge is
// its own small unit: the payment row is written first, then Stripe is called
// with an idempotency key derived from that row (ENG-02), then Stripe's
// answer is applied. A crash between the two is picked up by the next run,
// which repeats the call with the same key and gets the same answer.

const STUCK_AFTER_MS = 5 * 60_000;
// Stripe keeps idempotency keys for at least 24 hours; past that, a repeat
// could charge twice, so the reconciliation decides instead.
const KEY_LIFETIME_MS = 23 * 3_600_000;

export interface AutopayResult {
  charged: number;
  processing: number;
  failed: number;
  skipped: number;
}

export async function chargeDueAutopay(tenantId: string, now: Date = new Date(), budgetMs = 15_000): Promise<AutopayResult> {
  const result: AutopayResult = { charged: 0, processing: 0, failed: 0, skipped: 0 };
  if (!stripe()) return result;
  const started = Date.now();
  const tenant = await withServiceRole((tx) => tx.selectFrom("tenants").select(["stripe_account_id", "stripe_charges_enabled"]).where("id", "=", tenantId).executeTakeFirst());
  if (!tenant?.stripe_account_id || !tenant.stripe_charges_enabled) return result;
  const account = tenant.stripe_account_id;

  // Payments written but never answered (a crash or timeout mid-call).
  const stuck = await withServiceRole((tx) =>
    tx
      .selectFrom("payments")
      .select(["id", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("source", "=", "autopay")
      .where("status", "=", "pending")
      .where("created_at", "<", new Date(now.getTime() - STUCK_AFTER_MS))
      .limit(20)
      .execute(),
  );
  for (const s of stuck) {
    if (Date.now() - started > budgetMs) return result;
    if (now.getTime() - s.created_at.getTime() > KEY_LIFETIME_MS) continue;
    tally(result, await charge(tenantId, account, s.id, now));
  }

  const due = await withServiceRole((tx) =>
    tx
      .selectFrom("invoices as i")
      .select("i.id")
      .where("i.tenant_id", "=", tenantId)
      .where("i.status", "=", "open")
      .where("i.autopay_next_at", "<=", now)
      .orderBy("i.autopay_next_at")
      .limit(100)
      .execute(),
  );
  for (const { id } of due) {
    if (Date.now() - started > budgetMs) break;
    const paymentId = await withServiceRole(async (tx) => {
      const inv = await tx
        .selectFrom("invoices as i")
        .innerJoin("invoice_balances as b", (j) => j.onRef("b.invoice_id", "=", "i.id").onRef("b.tenant_id", "=", "i.tenant_id"))
        .select(["i.id", "i.customer_id", "i.number", "i.status", "i.autopay_next_at", "i.autopay_attempts", "b.open_cents"])
        .where("i.tenant_id", "=", tenantId)
        .where("i.id", "=", id)
        .forUpdate("i")
        .executeTakeFirst();
      if (!inv || inv.status !== "open" || !inv.autopay_next_at || inv.autopay_next_at > now) return null;
      const open = Number(inv.open_cents ?? 0);
      const method = await tx
        .selectFrom("payment_methods")
        .select(["id", "kind"])
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "=", inv.customer_id)
        .where("status", "=", "active")
        .executeTakeFirst();
      const inFlight = await tx
        .selectFrom("payments")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("invoice_id", "=", inv.id)
        .where("status", "in", ["pending", "processing"])
        .executeTakeFirst();
      if (open <= 0 || !method || inFlight || inv.autopay_attempts >= AUTOPAY_MAX_ATTEMPTS) {
        // Nothing to charge, nothing to charge with, or already on its way.
        if (!inFlight) await tx.updateTable("invoices").set({ autopay_next_at: null }).where("tenant_id", "=", tenantId).where("id", "=", inv.id).execute();
        return null;
      }
      const attempt = inv.autopay_attempts + 1;
      await tx.updateTable("invoices").set({ autopay_attempts: attempt, autopay_next_at: null }).where("tenant_id", "=", tenantId).where("id", "=", inv.id).execute();
      const row = await tx
        .insertInto("payments")
        .values({
          tenant_id: tenantId,
          customer_id: inv.customer_id,
          invoice_id: inv.id,
          client_payment_key: `autopay-${inv.id}-${attempt}`,
          method: method.kind === "us_bank_account" ? "ach" : "card_on_file",
          status: "pending",
          amount_cents: open,
          payment_method_id: method.id,
          source: "autopay",
          collected_by: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    });
    if (!paymentId) {
      result.skipped += 1;
      continue;
    }
    tally(result, await charge(tenantId, account, paymentId, now));
  }
  return result;
}

function tally(r: AutopayResult, outcome: "succeeded" | "processing" | "failed" | "pending" | "skipped") {
  if (outcome === "succeeded") r.charged += 1;
  else if (outcome === "processing") r.processing += 1;
  else if (outcome === "failed") r.failed += 1;
  else r.skipped += 1;
}

async function charge(tenantId: string, account: string, paymentId: string, now: Date): Promise<"succeeded" | "processing" | "failed" | "pending" | "skipped"> {
  const p = await withServiceRole((tx) =>
    tx
      .selectFrom("payments as p")
      .innerJoin("payment_methods as m", (j) => j.onRef("m.id", "=", "p.payment_method_id").onRef("m.tenant_id", "=", "p.tenant_id"))
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "p.customer_id").onRef("c.tenant_id", "=", "p.tenant_id"))
      .leftJoin("invoices as i", (j) => j.onRef("i.id", "=", "p.invoice_id").onRef("i.tenant_id", "=", "p.tenant_id"))
      .select(["p.id", "p.amount_cents", "p.invoice_id", "p.status", "m.stripe_payment_method_id", "m.stripe_mandate_id", "m.kind", "m.status as method_status", "c.stripe_customer_id", "i.number"])
      .where("p.tenant_id", "=", tenantId)
      .where("p.id", "=", paymentId)
      .executeTakeFirst(),
  );
  if (!p || p.status !== "pending") return "skipped";
  if (p.method_status !== "active" || !p.stripe_customer_id) {
    // Turned off between writing the payment and charging it: do not charge.
    await withServiceRole((tx) =>
      tx.updateTable("payments").set({ status: "canceled", failure_message: "Autopay was turned off before the charge" }).where("tenant_id", "=", tenantId).where("id", "=", paymentId).where("status", "=", "pending").execute(),
    );
    return "skipped";
  }
  try {
    const intent = await requireStripe().paymentIntents.create(
      {
        amount: p.amount_cents,
        currency: "usd",
        customer: p.stripe_customer_id,
        payment_method: p.stripe_payment_method_id,
        ...(p.kind === "us_bank_account" && p.stripe_mandate_id ? { mandate: p.stripe_mandate_id } : {}),
        off_session: true,
        confirm: true,
        description: p.number ? `Invoice ${p.number}` : "Autopay",
        metadata: { payment_id: p.id, invoice_id: p.invoice_id ?? "", source: "autopay" },
      },
      { stripeAccount: account, idempotencyKey: idempotency.charge(p.id) },
    );
    const applied = await withServiceRole((tx) => applyIntent(tx, tenantId, intent, now));
    return intent.status === "succeeded" ? "succeeded" : intent.status === "processing" ? "processing" : applied?.changed ? "failed" : "pending";
  } catch (error) {
    const { code, declined } = declineOf(error);
    if (!declined) {
      // Network or Stripe trouble: leave it pending; the next run repeats the same call.
      log.error("autopay charge error", { tenantId, paymentId, error: errorText(error) });
      return "pending";
    }
    const intentId = (error as { payment_intent?: { id?: string } }).payment_intent?.id ?? null;
    await withServiceRole(async (tx) => {
      const row = await tx.selectFrom("payments").select(["id", "customer_id", "invoice_id", "status", "amount_cents", "method", "source", "stripe_payment_intent_id"]).where("tenant_id", "=", tenantId).where("id", "=", paymentId).forUpdate().executeTakeFirstOrThrow();
      await movePayment(tx, tenantId, { ...row, status: row.status as "pending" }, { to: "failed", intentId, failureCode: code, at: now });
    });
    return "failed";
  }
}

/** After the office's "Invoice finished visits", charge what is due without holding up the page. */
export function kickAutopay(tenantId: string) {
  after(async () => {
    try {
      await chargeDueAutopay(tenantId);
      // Receipts and the new invoices' emails, in that order.
      await processOutbox({ tenantId, limit: 40 });
    } catch (error) {
      log.error("autopay kick failed", { tenantId, error: errorText(error) });
    }
  });
}
