import "server-only";
import { sql } from "kysely";
import { withServiceRole } from "@/lib/db/service";
import type { Tx } from "@/lib/db/rls";
import { formatAddress, formatPhone } from "@/lib/domain/contact";
import { formatCents } from "@/lib/domain/money";
import { todayIn } from "@/lib/domain/time";
import { appSecret, env } from "@/lib/env";
import { backoffMinutes, DEFAULT_BUDGET_MS, LEASE_MINUTES, mapPool, MAX_ATTEMPTS, nextBatchSize, SEND_CONCURRENCY } from "@/lib/jobs/outbox-lease";
import { sign } from "@/lib/messaging/signed";
import { emailSender, PermanentEmailError, type OutgoingEmail } from "@/lib/messaging/providers";
import { renderEmail, type EmailBusiness, type Topic, type TopicData } from "@/lib/messaging/templates";
import { formatLocalDate, formatWindow } from "@/lib/ui/format";

// ENG-04, FR-MSG-01/04/05, FR-MIG-19: send what the outbox holds. A runner
// claims a small batch with a lease (short transaction), prepares each event
// in a short read transaction, sends with no transaction open, then records
// the outcome in its own short transaction. Two runners never take the same
// event while its lease holds, and the provider's idempotency key (the event
// id) covers a crash between send and record. Before sending, the rules are
// checked again against the data as it is now: an
// unsubscribed customer, an imported customer before the business goes live,
// a visit that moved, an invoice already paid. Every outcome, sent or not, is
// a row in `messages` the business can see.


export function unsubscribeUrl(tenantId: string, customerId: string): string | null {
  const secret = appSecret();
  return secret ? `${env().APP_URL}/u/${sign({ t: tenantId, c: customerId }, secret)}` : null;
}

interface Event {
  id: string;
  tenant_id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

type Outcome = { status: "sent"; providerId: string | null } | { status: "suppressed"; reason: string } | { status: "retry"; error: string } | { status: "failed"; error: string };
interface Meta {
  customerId?: string;
  appointmentId?: string;
  invoiceId?: string;
  template: string;
  recipient: string;
}
type Prepared = (Outcome | { status: "ready"; email: Omit<OutgoingEmail, "idempotencyKey"> }) & Meta;

async function business(tx: Tx, tenantId: string): Promise<EmailBusiness & { timezone: string; live: boolean }> {
  const t = await tx.selectFrom("tenants").select(["name", "business_license_no", "white_label_at", "timezone", "messaging_live_at"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
  const o = await tx
    .selectFrom("offices")
    .select(["address_line1", "address_line2", "city", "region", "postal_code", "phone"])
    .where("tenant_id", "=", tenantId)
    .where("is_primary", "=", true)
    .executeTakeFirst();
  return {
    name: t.name,
    licenseNo: t.business_license_no,
    address: o ? formatAddress({ line1: o.address_line1, line2: o.address_line2, city: o.city, region: o.region, postalCode: o.postal_code }) : "",
    phone: o?.phone ? formatPhone(o.phone) : null,
    whiteLabel: t.white_label_at !== null,
    timezone: t.timezone,
    live: t.messaging_live_at !== null,
  };
}

async function topicData(tx: Tx, e: Event, portal: string): Promise<{ data: TopicData; customerId: string; appointmentId?: string; invoiceId?: string } | { suppress: string }> {
  const p = e.payload;
  if (e.topic === "portal.sign_in") return { data: { topic: "portal.sign_in", link: String(p.link) }, customerId: String(p.customerId) };
  if (e.topic === "appointment.reminder" || e.topic === "appointment.completed") {
    const a = await tx
      .selectFrom("appointments as a")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "a.technician_id").onRef("tech.tenant_id", "=", "a.tenant_id"))
      .select(["a.id", "a.customer_id", "a.status", "a.local_date", "a.window_start", "a.window_end", "t.name as service", "tech.display_name as tech"])
      .where("a.tenant_id", "=", e.tenant_id)
      .where("a.id", "=", String(p.appointmentId))
      .executeTakeFirst();
    if (!a) return { suppress: "The visit no longer exists" };
    if (e.topic === "appointment.reminder") {
      if (a.status !== "scheduled" || a.local_date !== p.date) return { suppress: "The visit moved or was cancelled after the reminder was queued" };
      return {
        data: { topic: "appointment.reminder", serviceType: a.service, dateText: `on ${formatLocalDate(a.local_date!, "full")}`, windowText: a.window_start || a.window_end ? formatWindow(a.window_start, a.window_end).replace(" - ", " and ") : null },
        customerId: a.customer_id,
        appointmentId: a.id,
      };
    }
    if (a.status !== "completed") return { suppress: "The visit is no longer marked complete" };
    return {
      data: { topic: "appointment.completed", serviceType: a.service, dateText: `on ${formatLocalDate(a.local_date!, "full")}`, technicianName: a.tech, recordUrl: `${portal}/visits/${a.id}` },
      customerId: a.customer_id,
      appointmentId: a.id,
    };
  }
  if (e.topic === "appointment.on_the_way") {
    const a = await tx
      .selectFrom("appointments as a")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("technicians as tech", (j) => j.onRef("tech.id", "=", "a.technician_id").onRef("tech.tenant_id", "=", "a.tenant_id"))
      .select(["a.id", "a.customer_id", "a.status", "a.local_date", "t.name as service", "tech.display_name as tech"])
      .where("a.tenant_id", "=", e.tenant_id)
      .where("a.id", "=", String(p.appointmentId))
      .executeTakeFirst();
    if (!a) return { suppress: "The visit no longer exists" };
    if (a.local_date !== p.date || (a.status !== "scheduled" && a.status !== "in_progress")) return { suppress: "The visit moved or was cancelled" };
    return { data: { topic: "appointment.on_the_way", serviceType: a.service, technicianName: a.tech }, customerId: a.customer_id, appointmentId: a.id };
  }
  if (e.topic === "payment.received") {
    const pay = await tx
      .selectFrom("payments as p")
      .leftJoin("invoices as i", (j) => j.onRef("i.id", "=", "p.invoice_id").onRef("i.tenant_id", "=", "p.tenant_id"))
      .select(["p.id", "p.customer_id", "p.amount_cents", "p.method", "p.status", "p.check_number", "i.number", "i.id as invoice_id"])
      .where("p.tenant_id", "=", e.tenant_id)
      .where("p.id", "=", String(p.paymentId))
      .executeTakeFirst();
    if (!pay) return { suppress: "The payment no longer exists" };
    if (pay.status !== "succeeded") return { suppress: "The payment did not go through" };
    const bal = await tx.selectFrom("customer_balances").select("balance_cents").where("tenant_id", "=", e.tenant_id).where("customer_id", "=", pay.customer_id).executeTakeFirst();
    const owed = Number(bal?.balance_cents ?? 0);
    const METHOD: Record<string, string> = { cash: "cash", check: pay.check_number ? `check #${pay.check_number}` : "check", card: "card", ach: "bank transfer", card_on_file: "card on file", other: "payment" };
    return {
      data: {
        topic: "payment.received",
        amountText: formatCents(pay.amount_cents),
        methodText: METHOD[pay.method] ?? "payment",
        invoiceNumber: pay.number === null ? null : Number(pay.number),
        balanceText: owed > 0 ? formatCents(owed) : owed < 0 ? `${formatCents(-owed)} in credit` : "$0.00",
        receiptUrl: portal,
      },
      customerId: pay.customer_id,
      invoiceId: pay.invoice_id ?? undefined,
    };
  }
  if (e.topic === "payment.failed") {
    const pay = await tx
      .selectFrom("payments as p")
      .leftJoin("invoices as i", (j) => j.onRef("i.id", "=", "p.invoice_id").onRef("i.tenant_id", "=", "p.tenant_id"))
      .select(["p.customer_id", "p.amount_cents", "p.status", "p.failure_message", "i.number", "i.id as invoice_id", "i.status as invoice_status"])
      .where("p.tenant_id", "=", e.tenant_id)
      .where("p.id", "=", String(p.paymentId))
      .executeTakeFirst();
    if (!pay) return { suppress: "The payment no longer exists" };
    if (pay.status !== "failed") return { suppress: "The payment went through after all" };
    if (pay.invoice_id && pay.invoice_status !== "open") return { suppress: "The invoice was paid or voided before the email went out" };
    const tz = (await tx.selectFrom("tenants").select("timezone").where("id", "=", e.tenant_id).executeTakeFirstOrThrow()).timezone;
    const retryAt = typeof p.retryAt === "string" ? new Date(p.retryAt) : null;
    return {
      data: {
        topic: "payment.failed",
        amountText: formatCents(pay.amount_cents),
        invoiceNumber: pay.number === null ? null : Number(pay.number),
        reasonText: pay.failure_message ?? "The payment was declined",
        retryText: retryAt ? `on ${formatLocalDate(todayIn(tz, retryAt), "full")}` : null,
        newMethod: p.newMethod === true,
        payUrl: portal,
      },
      customerId: pay.customer_id,
      invoiceId: pay.invoice_id ?? undefined,
    };
  }
  if (e.topic === "autopay.enabled") {
    const m = await tx
      .selectFrom("payment_methods")
      .select(["customer_id", "label", "consent_text", "status"])
      .where("tenant_id", "=", e.tenant_id)
      .where("stripe_payment_method_id", "=", String(p.paymentMethodId))
      .executeTakeFirst();
    if (!m) return { suppress: "The payment method is no longer on file" };
    if (m.status !== "active") return { suppress: "Autopay was turned off or changed before the email went out" };
    return { data: { topic: "autopay.enabled", methodLabel: m.label, consentText: m.consent_text, manageUrl: portal }, customerId: m.customer_id };
  }
  if (e.topic === "customer.switch_notice") {
    return { data: { topic: "customer.switch_notice", message: typeof p.message === "string" && p.message.trim() ? p.message.trim() : null }, customerId: String(p.customerId) };
  }
  if (e.topic === "invoice.issued") {
    const i = await tx
      .selectFrom("invoices as i")
      .innerJoin("invoice_balances as b", (j) => j.onRef("b.invoice_id", "=", "i.id").onRef("b.tenant_id", "=", "i.tenant_id"))
      .select(["i.id", "i.customer_id", "i.number", "i.status", "i.total_cents", "i.due_date", "b.open_cents"])
      .where("i.tenant_id", "=", e.tenant_id)
      .where("i.id", "=", String(p.invoiceId))
      .executeTakeFirst();
    if (!i) return { suppress: "The invoice no longer exists" };
    if (i.status !== "open" || Number(i.open_cents) <= 0) return { suppress: "Already paid or voided before the email went out" };
    const auto = await tx.selectFrom("payment_methods").select("label").where("tenant_id", "=", e.tenant_id).where("customer_id", "=", i.customer_id).where("status", "=", "active").executeTakeFirst();
    return {
      data: {
        topic: "invoice.issued",
        number: Number(i.number),
        totalText: formatCents(i.total_cents),
        dueText: i.due_date ? `on ${formatLocalDate(i.due_date, "full")}` : "on receipt",
        invoiceUrl: `${portal}/invoices/${i.id}`,
        autopayText: auto ? `You're on autopay, so it's paid with ${auto.label}. Nothing to do.` : null,
      },
      customerId: i.customer_id,
      invoiceId: i.id,
    };
  }
  return { suppress: `Unknown message type ${e.topic}` };
}

// Everything up to the send: re-check the rules against the data as it is now.
async function prepare(tx: Tx, e: Event): Promise<Prepared> {
  const portal = `${env().APP_URL}/p/${e.tenant_id}`;
  const biz = await business(tx, e.tenant_id);
  const resolved = await topicData(tx, e, portal);
  const base = { template: e.topic.replace(".", "_"), recipient: "" };
  if ("suppress" in resolved) return { status: "suppressed", reason: resolved.suppress, ...base, customerId: typeof e.payload.customerId === "string" ? e.payload.customerId : undefined };
  const c = await tx
    .selectFrom("customers")
    .select(["id", "email", "first_name", "display_name", "kind", "email_unsubscribed_at", "import_job_id"])
    .where("tenant_id", "=", e.tenant_id)
    .where("id", "=", resolved.customerId)
    .executeTakeFirst();
  const ids = { customerId: resolved.customerId, appointmentId: resolved.appointmentId, invoiceId: resolved.invoiceId };
  if (!c) return { status: "suppressed", reason: "The customer no longer exists", ...base, ...ids, customerId: undefined };
  const out = { ...base, ...ids, recipient: c.email ?? "" };
  if (!c.email) return { status: "suppressed", reason: "No email address on file", ...out };
  const requested = e.topic === "portal.sign_in";
  if (!requested && c.email_unsubscribed_at) return { status: "suppressed", reason: "The customer unsubscribed", ...out };
  // The switch-over notice is how imported customers hear about the change, so going live does not gate it.
  if (!requested && e.topic !== "customer.switch_notice" && c.import_job_id && !biz.live) return { status: "suppressed", reason: "Imported customer: messages start when the business goes live (Settings, Messages)", ...out };
  const sender = emailSender();
  if (!sender) return { status: "suppressed", reason: "Email sending is not set up yet", ...out };
  const unsubscribe = unsubscribeUrl(e.tenant_id, c.id);
  if (!requested && !unsubscribe) return { status: "suppressed", reason: "No unsubscribe link can be made (APP_SECRET is not set)", ...out };
  const email = renderEmail(resolved.data, {
    business: biz,
    greeting: c.kind === "commercial" ? c.display_name : (c.first_name ?? c.display_name),
    unsubscribeUrl: unsubscribe,
    portalUrl: portal,
  });
  return { status: "ready", email: { to: c.email, replyTo: null, fromName: biz.name, ...email }, ...out };
}

// The send itself: no transaction is open while this waits on the network.
async function deliver(e: Event, p: Prepared & { status: "ready" }): Promise<Outcome> {
  try {
    const sent = await emailSender()!.send({ idempotencyKey: e.id, ...p.email });
    return { status: "sent", providerId: sent.providerId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
    if (error instanceof PermanentEmailError || e.attempts + 1 >= MAX_ATTEMPTS) return { status: "failed", error: message };
    return { status: "retry", error: message };
  }
}

async function claim(size: number, tenantId?: string): Promise<Event[]> {
  return withServiceRole(async (tx) => {
    let q = tx
      .selectFrom("outbox_events")
      .select(["id", "tenant_id", "topic", "payload", "attempts"])
      .where("sent_at", "is", null)
      .where("channel", "=", "email")
      .where("attempts", "<", MAX_ATTEMPTS)
      .where("available_at", "<=", sql<Date>`now()`)
      .where((eb) => eb.or([eb("locked_until", "is", null), eb("locked_until", "<", sql<Date>`now()`)]))
      .orderBy("available_at")
      .limit(size)
      .forUpdate()
      .skipLocked();
    if (tenantId) q = q.where("tenant_id", "=", tenantId);
    const events = (await q.execute()) as Event[];
    if (events.length === 0) return events;
    await tx
      .updateTable("outbox_events")
      .set({ locked_until: sql`now() + ${`${LEASE_MINUTES} minutes`}::interval` })
      .where("id", "in", events.map((e) => e.id))
      .execute();
    return events;
  });
}

// Records one outcome and releases the lease. Guarded on sent_at so an event
// that someone else finished meanwhile is not recorded twice.
async function record(e: Event, r: Outcome, meta: Meta): Promise<void> {
  await withServiceRole(async (tx) => {
    if (r.status === "retry") {
      await tx
        .updateTable("outbox_events")
        .set({ attempts: e.attempts + 1, last_error: r.error, locked_until: null, available_at: sql`now() + ${`${backoffMinutes(e.attempts + 1)} minutes`}::interval` })
        .where("id", "=", e.id)
        .where("sent_at", "is", null)
        .execute();
      return;
    }
    // A sign-in link is single use; once handled it is not kept in the outbox.
    const payload = e.topic === "portal.sign_in" ? { ...e.payload, link: "[removed after sending]" } : e.payload;
    const done = await tx
      .updateTable("outbox_events")
      .set({ sent_at: new Date(), attempts: e.attempts + 1, last_error: r.status === "failed" ? r.error : null, locked_until: null, payload: JSON.stringify(payload) })
      .where("id", "=", e.id)
      .where("sent_at", "is", null)
      .returning("id")
      .executeTakeFirst();
    if (!done) return;
    // FR-MSG-05: every outcome is visible to the business.
    await tx
      .insertInto("messages")
      .values({
        tenant_id: e.tenant_id,
        customer_id: meta.customerId ?? null,
        appointment_id: meta.appointmentId ?? null,
        invoice_id: meta.invoiceId ?? null,
        outbox_event_id: e.id,
        channel: "email",
        template: meta.template,
        recipient: meta.recipient || "(none)",
        status: r.status === "sent" ? "sent" : r.status === "suppressed" ? "suppressed" : "failed",
        suppressed_reason: r.status === "suppressed" ? r.reason : null,
        error: r.status === "failed" ? r.error : null,
        provider: r.status === "sent" && emailSender()?.name === "resend" ? "resend" : null,
        provider_id: r.status === "sent" ? r.providerId : null,
        sent_at: r.status === "sent" ? new Date() : null,
      })
      .execute();
  });
}

/**
 * `limit` caps events handled per call; `budgetMs` stops claiming new batches
 * once spent, so cron and kick stay inside function limits (the rest waits for
 * the next run).
 */
export async function processOutbox(opts: { limit?: number; tenantId?: string; budgetMs?: number } = {}): Promise<{ sent: number; suppressed: number; failed: number; retry: number }> {
  const totals = { sent: 0, suppressed: 0, failed: 0, retry: 0 };
  const startedAt = Date.now();
  const limit = opts.limit ?? 50;
  let claimed = 0;
  for (;;) {
    const size = nextBatchSize({ limit, claimed, startedAt, now: Date.now(), budgetMs: opts.budgetMs ?? DEFAULT_BUDGET_MS });
    if (size === 0) break;
    const batch = await claim(size, opts.tenantId);
    claimed += batch.length;
    await mapPool(batch, SEND_CONCURRENCY, async (e) => {
      // One failing event becomes a retry and never stalls the others (FR-MSG-05).
      let meta: Meta = { template: e.topic.replace(".", "_"), recipient: "" };
      let r: Outcome;
      try {
        const p = await withServiceRole((tx) => prepare(tx, e));
        meta = p;
        r = p.status === "ready" ? await deliver(e, p) : p;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
        r = e.attempts + 1 >= MAX_ATTEMPTS ? { status: "failed", error: message } : { status: "retry", error: message };
      }
      try {
        await record(e, r, meta);
        totals[r.status] += 1;
      } catch (error) {
        // Not recorded: the lease expires and the event is claimed again; the provider key stops a double send.
        console.error(JSON.stringify({ msg: "outbox record failed", eventId: e.id, error: error instanceof Error ? error.message : String(error) }));
      }
    });
    if (batch.length < size) break;
  }
  return totals;
}

export type { Topic };
