import "server-only";
import { sql } from "kysely";
import { withServiceRole } from "@/lib/db/service";
import type { Tx } from "@/lib/db/rls";
import { formatAddress, formatPhone } from "@/lib/domain/contact";
import { formatCents } from "@/lib/domain/money";
import { todayIn } from "@/lib/domain/time";
import { appSecret, env } from "@/lib/env";
import { sign } from "@/lib/messaging/signed";
import { emailSender, PermanentEmailError } from "@/lib/messaging/providers";
import { renderEmail, type EmailBusiness, type Topic, type TopicData } from "@/lib/messaging/templates";
import { formatLocalDate, formatWindow } from "@/lib/ui/format";

// ENG-04, FR-MSG-01/04/05, FR-MIG-19: send what the outbox holds. Each event
// is its own transaction, locked so two runners never send it twice. Before
// sending, the rules are checked again against the data as it is now: an
// unsubscribed customer, an imported customer before the business goes live,
// a visit that moved, an invoice already paid. Every outcome, sent or not, is
// a row in `messages` the business can see.

const MAX_ATTEMPTS = 8;
const backoffMinutes = (attempt: number) => Math.min(240, 2 ** attempt);

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

async function sendOne(tx: Tx, e: Event): Promise<Outcome & { customerId?: string; appointmentId?: string; invoiceId?: string; template: string; recipient: string }> {
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
  try {
    const sent = await sender.send({ idempotencyKey: e.id, to: c.email, replyTo: null, fromName: biz.name, ...email });
    return { status: "sent", providerId: sent.providerId, ...out };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
    if (error instanceof PermanentEmailError || e.attempts + 1 >= MAX_ATTEMPTS) return { status: "failed", error: message, ...out };
    return { status: "retry", error: message, ...out };
  }
}

export async function processOutbox(opts: { limit?: number; tenantId?: string } = {}): Promise<{ sent: number; suppressed: number; failed: number; retry: number }> {
  const totals = { sent: 0, suppressed: 0, failed: 0, retry: 0 };
  for (let n = 0; n < (opts.limit ?? 50); n++) {
    const done = await withServiceRole(async (tx) => {
      let q = tx
        .selectFrom("outbox_events")
        .select(["id", "tenant_id", "topic", "payload", "attempts"])
        .where("sent_at", "is", null)
        .where("channel", "=", "email")
        .where("attempts", "<", MAX_ATTEMPTS)
        .where("available_at", "<=", sql<Date>`now()`)
        .orderBy("available_at")
        .limit(1)
        .forUpdate()
        .skipLocked();
      if (opts.tenantId) q = q.where("tenant_id", "=", opts.tenantId);
      const e = (await q.executeTakeFirst()) as Event | undefined;
      if (!e) return false;
      // ENG-04: an exception (bad payload, template, query) must not roll back the
      // whole transaction, or attempts never grows and this event blocks every run.
      // A savepoint keeps the lock and turns the throw into a retry outcome.
      await sql`savepoint send_one`.execute(tx);
      let r: Awaited<ReturnType<typeof sendOne>>;
      try {
        r = await sendOne(tx, e);
        await sql`release savepoint send_one`.execute(tx);
      } catch (error) {
        await sql`rollback to savepoint send_one`.execute(tx);
        const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
        r = { status: e.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "retry", error: message, template: e.topic.replace(".", "_"), recipient: "" };
      }
      totals[r.status] += 1;
      if (r.status === "retry") {
        await tx
          .updateTable("outbox_events")
          .set({ attempts: e.attempts + 1, last_error: r.error, available_at: sql`now() + ${`${backoffMinutes(e.attempts + 1)} minutes`}::interval` })
          .where("id", "=", e.id)
          .execute();
        return true;
      }
      // FR-MSG-05: every outcome is visible to the business.
      await tx
        .insertInto("messages")
        .values({
          tenant_id: e.tenant_id,
          customer_id: r.customerId ?? null,
          appointment_id: r.appointmentId ?? null,
          invoice_id: r.invoiceId ?? null,
          outbox_event_id: e.id,
          channel: "email",
          template: r.template,
          recipient: r.recipient || "(none)",
          status: r.status === "sent" ? "sent" : r.status === "suppressed" ? "suppressed" : "failed",
          suppressed_reason: r.status === "suppressed" ? r.reason : null,
          error: r.status === "failed" ? r.error : null,
          provider: r.status === "sent" && emailSender()?.name === "resend" ? "resend" : null,
          provider_id: r.status === "sent" ? r.providerId : null,
          sent_at: r.status === "sent" ? new Date() : null,
        })
        .execute();
      // A sign-in link is single use; once handled it is not kept in the outbox.
      const payload = e.topic === "portal.sign_in" ? { ...e.payload, link: "[removed after sending]" } : e.payload;
      await tx
        .updateTable("outbox_events")
        .set({ sent_at: new Date(), attempts: e.attempts + 1, last_error: r.status === "failed" ? r.error : null, payload: JSON.stringify(payload) })
        .where("id", "=", e.id)
        .execute();
      return true;
    });
    if (!done) break;
  }
  return totals;
}

export type { Topic };
