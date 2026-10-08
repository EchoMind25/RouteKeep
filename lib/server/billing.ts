import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { pgConstraint, pgErrorCode, withRls, type Tx } from "@/lib/db/rls";
import { enqueueEmail } from "@/lib/messaging/enqueue";
import { agingBucket, type AgingBucket } from "@/lib/domain/billing";
import { formatAddress } from "@/lib/domain/contact";
import { parseLocalDate, todayIn } from "@/lib/domain/time";
import { businessHeader, type BusinessHeader } from "@/lib/server/business";
import { runBilling, settleInvoice, type BillingRunResult } from "@/lib/server/billing-run";

// M4 office billing (FR-BIL-01, 04, 06, 08): invoices, payments taken in the
// office, credits and voids. Money is integer cents and the ledger is the only
// source of balances (ENG-06): nothing here edits a posted amount.

/** FR-BIL-01: the office's "Invoice finished visits" button runs the same billing as the nightly job. */
export function runBillingNow(m: MemberSession): Promise<BillingRunResult> {
  return runBilling((fn) => withRls(m.claims, fn), m.tenantId);
}

export async function lastBillingRun(m: MemberSession) {
  return withRls(m.claims, (tx) =>
    tx.selectFrom("billing_runs").select(["started_at", "finished_at", "invoices_created", "payments_posted", "failures"]).orderBy("started_at", "desc").limit(1).executeTakeFirst(),
  );
}

export type InvoiceFilter = "open" | "overdue" | "paid" | "void" | "all";

export interface InvoiceRow {
  id: string;
  number: number;
  customerId: string;
  customerName: string;
  status: string;
  issuedAt: Date | null;
  dueDate: string | null;
  totalCents: number;
  openCents: number;
  overdue: boolean;
}

export async function listInvoices(m: MemberSession, filter: InvoiceFilter, opts: { customerId?: string; limit?: number } = {}): Promise<InvoiceRow[]> {
  return withRls(m.claims, async (tx) => {
    const today = todayIn(m.timezone);
    let q = tx
      .selectFrom("invoice_balances as b")
      .innerJoin("invoices as i", (j) => j.onRef("i.id", "=", "b.invoice_id").onRef("i.tenant_id", "=", "b.tenant_id"))
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "i.customer_id").onRef("c.tenant_id", "=", "i.tenant_id"))
      .select(["i.id", "i.number", "i.customer_id", "c.display_name", "i.status", "i.issued_at", "i.due_date", "i.total_cents", "b.open_cents"])
      .orderBy("i.number", "desc")
      .limit(opts.limit ?? 500);
    if (filter === "open") q = q.where("i.status", "=", "open");
    if (filter === "overdue") q = q.where("i.status", "=", "open").where("i.due_date", "<", today);
    if (filter === "paid") q = q.where("i.status", "=", "paid");
    if (filter === "void") q = q.where("i.status", "in", ["void", "uncollectible"]);
    if (opts.customerId) q = q.where("i.customer_id", "=", opts.customerId);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      number: Number(r.number),
      customerId: r.customer_id,
      customerName: r.display_name,
      status: r.status,
      issuedAt: r.issued_at,
      dueDate: r.due_date,
      totalCents: r.total_cents,
      openCents: Number(r.open_cents ?? 0),
      overdue: r.status === "open" && r.due_date !== null && r.due_date < today,
    }));
  });
}

export interface InvoiceDetail {
  id: string;
  number: number;
  status: string;
  issuedAt: Date | null;
  dueDate: string | null;
  paidAt: Date | null;
  voidReason: string | null;
  totalCents: number;
  openCents: number;
  timeZone: string;
  customer: { id: string; name: string; address: string; email: string | null };
  lines: { id: string; description: string; quantity: number; unitCents: number; amountCents: number; appointmentId: string | null }[];
  ledger: { id: string; type: string; amountCents: number; memo: string | null; occurredAt: Date; method: string | null; checkNumber: string | null }[];
  business: BusinessHeader & { logoPath: string | null };
}

export async function getInvoice(m: MemberSession, id: string): Promise<InvoiceDetail | null> {
  return withRls(m.claims, (tx) => invoiceIn(tx, id));
}

/** The invoice as whoever owns `tx` may see it: a member (withRls) or the customer (withPortal). */
export async function invoiceIn(tx: Tx, id: string): Promise<InvoiceDetail | null> {
  const i = await tx
    .selectFrom("invoices as i")
    .innerJoin("invoice_balances as b", (j) => j.onRef("b.invoice_id", "=", "i.id").onRef("b.tenant_id", "=", "i.tenant_id"))
    .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "i.customer_id").onRef("c.tenant_id", "=", "i.tenant_id"))
    .select([
      "i.id", "i.number", "i.status", "i.issued_at", "i.due_date", "i.paid_at", "i.void_reason", "i.total_cents", "b.open_cents",
      "c.id as customer_id", "c.display_name", "c.email", "c.billing_address_line1", "c.billing_address_line2", "c.billing_city", "c.billing_region", "c.billing_postal_code",
    ])
    .where("i.id", "=", id)
    .executeTakeFirst();
  if (!i) return null;
  const business = await businessHeader(tx);
  const logo = await tx.selectFrom("tenants").select("logo_path").executeTakeFirstOrThrow();
  const property = await tx
    .selectFrom("properties")
    .select(["address_line1", "address_line2", "city", "region", "postal_code"])
    .where("customer_id", "=", i.customer_id)
    .orderBy("created_at")
    .executeTakeFirst();
  const lines = await tx.selectFrom("invoice_lines").select(["id", "description", "quantity", "unit_amount_cents", "amount_cents", "appointment_id"]).where("invoice_id", "=", id).orderBy("created_at").execute();
  const ledger = await tx
    .selectFrom("ledger_entries as e")
    .leftJoin("payments as p", (j) => j.onRef("p.id", "=", "e.payment_id").onRef("p.tenant_id", "=", "e.tenant_id"))
    .select(["e.id", "e.type", "e.amount_cents", "e.memo", "e.occurred_at", "p.method", "p.check_number"])
    .where("e.invoice_id", "=", id)
    .orderBy("e.occurred_at")
    .execute();
  const address =
    i.billing_address_line1 && i.billing_city && i.billing_region && i.billing_postal_code
      ? formatAddress({ line1: i.billing_address_line1, line2: i.billing_address_line2, city: i.billing_city, region: i.billing_region, postalCode: i.billing_postal_code })
      : property
        ? formatAddress({ line1: property.address_line1, line2: property.address_line2, city: property.city, region: property.region, postalCode: property.postal_code })
        : "";
  return {
    id: i.id,
    number: Number(i.number),
    status: i.status,
    issuedAt: i.issued_at,
    dueDate: i.due_date,
    paidAt: i.paid_at,
    voidReason: i.void_reason,
    totalCents: i.total_cents,
    openCents: Number(i.open_cents ?? 0),
    timeZone: business.timezone,
    customer: { id: i.customer_id, name: i.display_name, address, email: i.email },
    lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), unitCents: l.unit_amount_cents, amountCents: l.amount_cents, appointmentId: l.appointment_id })),
    ledger: ledger.map((e) => ({ id: e.id, type: e.type, amountCents: e.amount_cents, memo: e.memo, occurredAt: e.occurred_at, method: e.method, checkNumber: e.check_number })),
    business: { ...business, logoPath: logo.logo_path },
  };
}

export class BillingRefusedError extends Error {
  override name = "BillingRefusedError";
}

async function openInvoice(tx: Parameters<Parameters<typeof withRls>[1]>[0], id: string) {
  const row = await tx
    .selectFrom("invoices as i")
    .innerJoin("invoice_balances as b", (j) => j.onRef("b.invoice_id", "=", "i.id").onRef("b.tenant_id", "=", "i.tenant_id"))
    .select(["i.id", "i.customer_id", "i.status", "i.total_cents", "b.open_cents"])
    .where("i.id", "=", id)
    .forUpdate("i")
    .executeTakeFirst();
  if (!row) throw new BillingRefusedError("That invoice is no longer on file.");
  return { ...row, open_cents: Number(row.open_cents ?? 0) };
}

/** FR-BIL-06: cash, check or other payment taken in the office, applied to one invoice. Idempotent by client key (ENG-01). */
export async function recordPayment(
  m: MemberSession,
  input: { invoiceId: string; key: string; method: "cash" | "check" | "other"; amountCents: number; checkNumber: string | null; memo: string | null },
): Promise<void> {
  try {
    await withRls(m.claims, async (tx) => {
      const inv = await openInvoice(tx, input.invoiceId);
      const existing = await tx.selectFrom("payments").select("id").where("client_payment_key", "=", input.key).executeTakeFirst();
      if (existing) return;
      if (inv.status !== "open") throw new BillingRefusedError("Only an open invoice takes a payment.");
      if (input.amountCents > inv.open_cents) throw new BillingRefusedError("That is more than the invoice still owes. Record the extra as a separate credit if the customer prepaid.");
      const now = new Date();
      const payment = await tx
        .insertInto("payments")
        .values({ customer_id: inv.customer_id, invoice_id: inv.id, client_payment_key: input.key, method: input.method, status: "succeeded", amount_cents: input.amountCents, check_number: input.checkNumber, received_at: now })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("ledger_entries")
        .values({ customer_id: inv.customer_id, type: "payment", amount_cents: -input.amountCents, payment_id: payment.id, invoice_id: inv.id, entry_key: `payment:${payment.id}`, memo: input.memo, occurred_at: now })
        .execute();
      // FR-BIL-05: a receipt, once this commits.
      await enqueueEmail(tx, { tenantId: m.tenantId, topic: "payment.received", key: payment.id, payload: { paymentId: payment.id } });
      await settleInvoice(tx, inv.id, now);
    });
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "payments_client_key") return;
    throw error;
  }
}

/** FR-BIL-06: a credit lowers what the customer owes on an invoice; it never edits the invoice. */
export async function addCredit(m: MemberSession, input: { invoiceId: string; key: string; amountCents: number; reason: string }): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const inv = await openInvoice(tx, input.invoiceId);
    if (inv.status !== "open") throw new BillingRefusedError("Only an open invoice takes a credit.");
    if (input.amountCents > inv.open_cents) throw new BillingRefusedError("A credit cannot be more than the invoice still owes.");
    const now = new Date();
    await tx
      .insertInto("ledger_entries")
      .values({ customer_id: inv.customer_id, type: "credit", amount_cents: -input.amountCents, invoice_id: inv.id, entry_key: `credit:${input.key}`, memo: input.reason, occurred_at: now })
      .onConflict((oc) => oc.constraint("ledger_entry_key").doNothing())
      .execute();
    await settleInvoice(tx, inv.id, now);
  });
}

/** Voids an invoice nobody has paid toward: the ledger gets a matching credit, history stays. */
export async function voidInvoice(m: MemberSession, input: { invoiceId: string; reason: string }): Promise<void> {
  await withRls(m.claims, async (tx) => {
    const inv = await openInvoice(tx, input.invoiceId);
    if (inv.status !== "open") throw new BillingRefusedError("Only an open invoice can be voided.");
    if (inv.open_cents !== inv.total_cents) throw new BillingRefusedError("Payments or credits are already on this invoice. Credit the rest instead of voiding.");
    const now = new Date();
    await tx
      .insertInto("ledger_entries")
      .values({ customer_id: inv.customer_id, type: "credit", amount_cents: -inv.total_cents, invoice_id: inv.id, entry_key: `void:${inv.id}`, memo: `Voided: ${input.reason}`, occurred_at: now })
      .onConflict((oc) => oc.constraint("ledger_entry_key").doNothing())
      .execute();
    await tx.updateTable("invoices").set({ status: "void", voided_at: now, void_reason: input.reason }).where("id", "=", inv.id).execute();
  });
}

export interface CollectionRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  invoices: number;
  oldestDue: string;
  bucket: AgingBucket;
  openCents: number;
}

/** FR-BIL-04: who owes, oldest first. */
export async function collections(m: MemberSession): Promise<CollectionRow[]> {
  return withRls(m.claims, async (tx) => {
    const today = todayIn(m.timezone);
    const rows = await tx
      .selectFrom("invoice_balances as b")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "b.customer_id").onRef("c.tenant_id", "=", "b.tenant_id"))
      .select([
        "b.customer_id", "c.display_name", "c.phone", "c.email",
        sql<number>`count(*)::int`.as("invoices"),
        sql<string>`min(b.due_date)::text`.as("oldest_due"),
        sql<string>`sum(b.open_cents)::text`.as("open_cents"),
      ])
      .where("b.status", "=", "open")
      .where("b.open_cents", ">", sql<number>`0`)
      .where("b.due_date", "<", today)
      .groupBy(["b.customer_id", "c.display_name", "c.phone", "c.email"])
      .orderBy(sql`min(b.due_date)`)
      .limit(500)
      .execute();
    return rows.map((r) => ({
      customerId: r.customer_id!,
      customerName: r.display_name,
      phone: r.phone,
      email: r.email,
      invoices: r.invoices,
      oldestDue: r.oldest_due,
      bucket: agingBucket(parseLocalDate(r.oldest_due), today),
      openCents: Number(r.open_cents),
    }));
  });
}
