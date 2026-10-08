import "server-only";
import { sql } from "kysely";
import type { Tx } from "@/lib/db/rls";
import { billingPeriod, periodClosed, type BillingMode } from "@/lib/domain/billing";
import { parseLocalDate, todayIn, type LocalDate } from "@/lib/domain/time";
import { enqueueEmail } from "@/lib/messaging/enqueue";
import { formatLocalDate } from "@/lib/ui/format";

// FR-BIL-01, FR-BIL-03: the billing run. It finds finished visits that are on
// no invoice yet, invoices them (one per visit, or one per closed period for
// plans billed monthly, quarterly or yearly), posts payments taken in the
// field to the ledger against their visit's invoice, and marks invoices paid
// once the ledger says so. Every item runs in its own transaction: one that
// fails is recorded and the rest carry on, and a rerun picks up only what is
// still undone (ENG-01: invoices are unique per visit and per period, ledger
// entries per key).
//
// The caller decides whose transaction: withRls for the office's "Invoice
// finished visits" button, withServiceRole for the nightly job.

export type RunTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface BillingRunResult {
  runId: string;
  invoicesCreated: number;
  paymentsPosted: number;
  invoicesPaid: number;
  failures: { item: string; message: string }[];
}

interface VisitRow {
  id: string;
  customer_id: string;
  subscription_id: string | null;
  local_date: string;
  price_cents: number;
  is_initial: boolean;
  billing_mode: string | null;
  service_type: string;
}

type Item =
  | { kind: "visit"; visit: VisitRow }
  | { kind: "period"; subscriptionId: string; customerId: string; periodKey: string; visits: VisitRow[] };

function lineFor(v: VisitRow): { description: string; appointment_id: string; unit_amount_cents: number; amount_cents: number; quantity: string } {
  return {
    description: `${v.service_type}${v.is_initial ? ", first service" : ""}, ${formatLocalDate(v.local_date)}`,
    appointment_id: v.id,
    unit_amount_cents: v.price_cents,
    amount_cents: v.price_cents,
    quantity: "1",
  };
}

async function postInvoice(tx: Tx, input: { tenantId: string; customerId: string; subscriptionId: string | null; appointmentId: string | null; periodKey: string; visits: VisitRow[]; today: LocalDate; now: Date }): Promise<string | null> {
  // Under lock, so two runs at once cannot both invoice the same visit.
  const ids = input.visits.map((v) => v.id);
  await sql`select 1 from public.appointments where id = any(${ids}::uuid[]) for update`.execute(tx);
  const done = await tx.selectFrom("invoice_lines").select("appointment_id").where("appointment_id", "in", ids).execute();
  const visits = input.visits.filter((v) => !done.some((d) => d.appointment_id === v.id));
  if (!visits.length) return null;
  const total = visits.reduce((sum, v) => sum + v.price_cents, 0);
  // A period already invoiced (a visit finished late) gets a supplementary invoice.
  const taken = input.subscriptionId
    ? await tx.selectFrom("invoices").select("id").where("subscription_id", "=", input.subscriptionId).where("period_key", "=", input.periodKey).executeTakeFirst()
    : undefined;
  const invoice = await tx
    .insertInto("invoices")
    .values({
      // Named outright: under the service role there is no tenant in the session.
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      subscription_id: input.subscriptionId,
      appointment_id: input.appointmentId,
      period_key: taken ? `${input.periodKey}+${visits[0]!.id.slice(0, 8)}` : input.periodKey,
      status: "open",
      total_cents: total,
      issued_at: input.now,
      due_date: input.today,
      source: "billing_run",
      // The number comes from the per-tenant counter (app.assign_invoice_number).
      number: undefined as unknown as number,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("invoice_lines")
    .values(visits.map((v) => ({ tenant_id: input.tenantId, invoice_id: invoice.id, ...lineFor(v) })))
    .execute();
  await tx
    .insertInto("ledger_entries")
    .values({ tenant_id: input.tenantId, customer_id: input.customerId, type: "invoice", amount_cents: total, invoice_id: invoice.id, entry_key: `invoice:${invoice.id}`, occurred_at: input.now, source: "billing_run" })
    .execute();
  // FR-BIL-05: the invoice email waits a few minutes, so cash taken in the
  // field is applied first; one paid by then is not sent (lib/jobs/outbox.ts).
  await enqueueEmail(tx, { tenantId: input.tenantId, topic: "invoice.issued", key: invoice.id, payload: { invoiceId: invoice.id }, availableAt: new Date(input.now.getTime() + 10 * 60_000) });
  return invoice.id;
}

/** FR-BIL-06: an invoice is paid once its ledger balance reaches zero. */
export async function settleInvoice(tx: Tx, invoiceId: string, now: Date): Promise<boolean> {
  const row = await tx.selectFrom("invoice_balances").select(["status", "open_cents"]).where("invoice_id", "=", invoiceId).executeTakeFirst();
  if (!row || row.status !== "open" || Number(row.open_cents) > 0) return false;
  await tx.updateTable("invoices").set({ status: "paid", paid_at: now }).where("id", "=", invoiceId).where("status", "=", "open").execute();
  return true;
}

export async function runBilling(runTx: RunTx, tenantId: string, now: Date = new Date()): Promise<BillingRunResult> {
  const failures: BillingRunResult["failures"] = [];
  let invoicesCreated = 0;
  let paymentsPosted = 0;
  let invoicesPaid = 0;

  const { today, visits, runId } = await runTx(async (tx) => {
    const tenant = await tx.selectFrom("tenants").select("timezone").where("id", "=", tenantId).executeTakeFirstOrThrow();
    const run = await tx.insertInto("billing_runs").values({ tenant_id: tenantId, started_at: now }).returning("id").executeTakeFirstOrThrow();
    const rows = await tx
      .selectFrom("appointments as a")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "a.service_type_id").onRef("t.tenant_id", "=", "a.tenant_id"))
      .leftJoin("subscriptions as s", (j) => j.onRef("s.id", "=", "a.subscription_id").onRef("s.tenant_id", "=", "a.tenant_id"))
      .select(["a.id", "a.customer_id", "a.subscription_id", "a.local_date", "a.price_cents", "a.is_initial", "s.billing_mode", "t.name as service_type"])
      .where("a.tenant_id", "=", tenantId)
      .where("a.status", "=", "completed")
      .where("a.price_cents", ">", 0)
      .where("a.local_date", "is not", null)
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom("invoice_lines as l").select("l.id").whereRef("l.appointment_id", "=", "a.id").whereRef("l.tenant_id", "=", "a.tenant_id"))))
      .orderBy("a.local_date")
      .orderBy("a.id")
      .limit(2000)
      .execute();
    return { today: todayIn(tenant.timezone, now), runId: run.id, visits: rows as unknown as VisitRow[] };
  });

  // Work out the items: each per-service visit alone; each closed period of a
  // plan billed by period as one.
  const items: Item[] = [];
  const periods = new Map<string, Extract<Item, { kind: "period" }>>();
  for (const v of visits) {
    const mode = (v.billing_mode ?? "per_service") as BillingMode;
    if (!v.subscription_id || mode === "per_service") {
      items.push({ kind: "visit", visit: v });
      continue;
    }
    const period = billingPeriod(parseLocalDate(v.local_date), mode);
    if (!periodClosed(period, today)) continue;
    const key = `${v.subscription_id}|${period.key}`;
    const group = periods.get(key) ?? { kind: "period", subscriptionId: v.subscription_id, customerId: v.customer_id, periodKey: period.key, visits: [] };
    group.visits.push(v);
    periods.set(key, group);
  }
  items.push(...periods.values());

  for (const item of items) {
    const label = item.kind === "visit" ? `visit ${item.visit.id}` : `plan ${item.subscriptionId} ${item.periodKey}`;
    try {
      const id = await runTx((tx) =>
        item.kind === "visit"
          ? postInvoice(tx, { tenantId, customerId: item.visit.customer_id, subscriptionId: item.visit.subscription_id, appointmentId: item.visit.id, periodKey: `visit:${item.visit.id}`, visits: [item.visit], today, now })
          : postInvoice(tx, { tenantId, customerId: item.customerId, subscriptionId: item.subscriptionId, appointmentId: null, periodKey: item.periodKey, visits: item.visits, today, now }),
      );
      if (id) invoicesCreated += 1;
    } catch (error) {
      failures.push({ item: label, message: error instanceof Error ? error.message : String(error) });
    }
  }

  // Payments taken in the field (or anywhere) that the ledger has not seen yet.
  const unposted = await runTx((tx) =>
    tx
      .selectFrom("payments as p")
      .select(["p.id", "p.customer_id", "p.amount_cents", "p.received_at", "p.invoice_id", "p.appointment_id"])
      .where("p.tenant_id", "=", tenantId)
      .where("p.status", "=", "succeeded")
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom("ledger_entries as e").select("e.id").whereRef("e.payment_id", "=", "p.id").whereRef("e.tenant_id", "=", "p.tenant_id"))))
      .orderBy("p.received_at")
      .limit(2000)
      .execute(),
  );
  const touched = new Set<string>();
  for (const p of unposted) {
    try {
      await runTx(async (tx) => {
        const invoiceId =
          p.invoice_id ??
          (p.appointment_id
            ? ((await tx.selectFrom("invoice_lines").select("invoice_id").where("appointment_id", "=", p.appointment_id).executeTakeFirst())?.invoice_id ?? null)
            : null);
        const inserted = await tx
          .insertInto("ledger_entries")
          .values({ tenant_id: tenantId, customer_id: p.customer_id, type: "payment", amount_cents: -p.amount_cents, payment_id: p.id, invoice_id: invoiceId, entry_key: `payment:${p.id}`, occurred_at: p.received_at ?? now, source: "billing_run" })
          .onConflict((oc) => oc.constraint("ledger_entry_key").doNothing())
          .returning("id")
          .executeTakeFirst();
        if (inserted) {
          paymentsPosted += 1;
          // FR-BIL-05: a receipt for money taken in the field.
          await enqueueEmail(tx, { tenantId, topic: "payment.received", key: p.id, payload: { paymentId: p.id } });
        }
        if (invoiceId) touched.add(invoiceId);
      });
    } catch (error) {
      failures.push({ item: `payment ${p.id}`, message: error instanceof Error ? error.message : String(error) });
    }
  }

  // Anything now covered is paid.
  const open = await runTx((tx) =>
    tx.selectFrom("invoice_balances").select("invoice_id").where("tenant_id", "=", tenantId).where("status", "=", "open").where("open_cents", "<=", sql<number>`0`).execute(),
  );
  for (const { invoice_id } of open) if (invoice_id) touched.add(invoice_id);
  for (const invoiceId of touched) {
    try {
      if (await runTx((tx) => settleInvoice(tx, invoiceId, now))) invoicesPaid += 1;
    } catch (error) {
      failures.push({ item: `invoice ${invoiceId}`, message: error instanceof Error ? error.message : String(error) });
    }
  }

  await runTx((tx) =>
    tx
      .updateTable("billing_runs")
      .set({ finished_at: new Date(), invoices_created: invoicesCreated, payments_posted: paymentsPosted, failures: JSON.stringify(failures) })
      .where("id", "=", runId)
      .execute(),
  );
  return { runId, invoicesCreated, paymentsPosted, invoicesPaid, failures };
}
