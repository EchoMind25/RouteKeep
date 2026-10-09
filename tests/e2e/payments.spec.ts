import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import { linkIn, mailTo } from "./mail";
import { StripeStandIn } from "./stripe-standin";

// M4 stage 2 end to end against the Stripe stand-in: D-09 connect, FR-POR-02
// pay an invoice, ENG-03 signed and deduplicated webhooks, FR-BIL-02 autopay
// with CR-06 consent and revoke, ENG-02 idempotency keys, FR-BIL-04 decline
// and retry schedule, FR-BIL-06 refunds as ledger entries, FR-BIL-07
// reconciliation catching a lost webhook.

const base = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
const stripe = new StripeStandIn(base);

test.beforeAll(async () => stripe.start());
test.afterAll(async () => stripe.stop());

async function payments(invoiceId: string) {
  return adminQuery<{ id: string; status: string; method: string; source: string; amount_cents: number; stripe_payment_intent_id: string | null; refunded_cents: number }>(
    "select id, status, method, source, amount_cents, stripe_payment_intent_id, refunded_cents from public.payments where invoice_id = $1 order by created_at",
    [invoiceId],
  );
}

async function invoiceFor(appointmentId: string) {
  const [row] = await adminQuery<{ id: string; number: number; status: string; autopay_next_at: Date | null; autopay_attempts: number }>(
    "select i.id, i.number::int as number, i.status, i.autopay_next_at, i.autopay_attempts from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where l.appointment_id = $1",
    [appointmentId],
  );
  return row!;
}

async function finishAndBill(page: Page, stop: string) {
  await adminQuery("update public.appointments set status = 'completed', completed_at = now(), price_cents = 6900 where id = $1", [stop]);
  await page.goto("/billing");
  await page.getByRole("button", { name: "Invoice finished visits" }).click();
  await expect(page.getByText("1 invoice made, 0 payments posted.")).toBeVisible();
  return invoiceFor(stop);
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}

test("M4 stage 2: connect, pay online, autopay with retries, refund, revoke, reconcile", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const started = Date.now();
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Rowan Achterberg"],
    stops: [1, 2, 3].map((k) => ({ name: "Marisol Quintero", lat: OFFICE.lat, lng: OFFICE.lng + 0.01 * k, tech: 0 })),
  });
  const [first, second, third] = day.stopIds as [string, string, string];
  // Three visits for one customer.
  await adminQuery("update public.appointments set customer_id = $2, property_id = $3 where id = any($1::uuid[])", [[second, third], day.customerIds[0], day.propertyIds[0]]);
  const email = `payer-${randomUUID().slice(0, 8)}@example.com`;
  await adminQuery("update public.customers set email = $2, first_name = 'Marisol' where id = $1", [day.customerIds[0], email]);

  // D-09: the owner connects the business's own Stripe account.
  await signInAs(page, day.email);
  await page.goto("/settings/payments");
  await expect(page.getByRole("heading", { name: "Card and bank payments" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Connect Stripe" }).click();
  await expect(page.getByText("Customers can pay online and set up autopay.")).toBeVisible();
  const [created] = stripe.calls(/^\/v1\/accounts$/);
  expect(created!.body.type).toBe("standard");
  expect(created!.idempotencyKey).toBe(`rk-account-${day.tenantId}`);
  const acct = String((await adminQuery<{ a: string }>("select stripe_account_id as a from public.tenants where id = $1", [day.tenantId]))[0]!.a);

  // FR-POR-02: the customer pays an invoice from their account page.
  const inv1 = await finishAndBill(page, first);
  const customer = await browser.newContext({ baseURL: base });
  const portal = await customer.newPage();
  await portal.goto(`/p/${day.tenantId}`);
  await portal.getByLabel("Email").fill(email);
  await portal.getByRole("button", { name: "Email me a sign-in link" }).click();
  await portal.goto(linkIn((await mailTo(email, /^Your sign-in link/, started)).text, /https?:\/\/\S+\/auth\?token=\S+/));
  await expect(portal.getByRole("heading", { name: "Hi Marisol" })).toBeVisible();
  await expectAccessible(portal);
  await portal.getByRole("button", { name: `Pay $69.00 for invoice ${inv1.number}` }).click();
  await expect(portal.getByRole("heading", { name: "Stand-in: pay" })).toBeVisible();
  await portal.getByRole("button", { name: "Pay by card" }).click();
  await expect(portal.getByText(`Invoice ${inv1.number} is paid. A receipt is on its way to your email.`)).toBeVisible();
  const [paid] = await payments(inv1.id);
  expect(paid).toMatchObject({ status: "succeeded", method: "card", source: "portal", amount_cents: 6900 });
  const [checkout] = stripe.calls(/^\/v1\/checkout\/sessions$/);
  expect(checkout!.account).toBe(acct);
  expect(checkout!.idempotencyKey).toBe(`rk-checkout-${paid!.id}`);
  expect(checkout!.body).not.toHaveProperty("payment_method_types");
  expect((await mailTo(email, /^Receipt: \$69\.00/, started)).text).toContain("We received $69.00 by card for invoice");
  expect((await invoiceFor(first)).status).toBe("paid");

  // ENG-03: an unsigned or tampered event changes nothing; a replay is acknowledged once.
  const last = stripe.delivered.find((d) => d.type === "payment_intent.succeeded")!;
  expect(await stripe.post(last.payload, "t=1,v1=deadbeef")).toBe(400);
  expect(await stripe.post(last.payload.replace('"amount_received":6900', '"amount_received":1'), stripe.signature(last.payload))).toBe(400);
  const replay = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": stripe.signature(last.payload) }, body: last.payload });
  expect(await replay.json()).toMatchObject({ outcome: "duplicate" });
  const [entries] = await adminQuery<{ n: number }>("select count(*)::int as n from public.ledger_entries where invoice_id = $1 and type = 'payment'", [inv1.id]);
  expect(entries!.n).toBe(1);

  // FR-BIL-02, CR-06: autopay, with the words agreed to shown on Stripe's page and kept.
  await portal.getByRole("button", { name: "Set up autopay" }).click();
  await expect(portal.getByText(/I allow Dispatch Test Pest to charge this payment method for each invoice/)).toBeVisible();
  await portal.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(portal.getByText("Autopay is on with Visa ending 4242.")).toBeVisible();
  await expect(portal.getByRole("region", { name: "Autopay" }).getByText("Visa ending 4242")).toBeVisible();
  expect((await mailTo(email, /^Autopay is on/, started)).text).toContain("What you agreed to");
  const [method] = await adminQuery<{ consent_text: string; status: string }>("select consent_text, status from public.payment_methods where customer_id = $1", [day.customerIds[0]]);
  expect(method).toMatchObject({ status: "active" });
  expect(method!.consent_text).toMatch(/turn autopay off at any time/);

  // The next invoice is charged when it is issued (ENG-02: key from the payment row).
  const inv2 = await finishAndBill(page, second);
  const auto = await until(() => payments(inv2.id), (p) => p[0]?.status === "succeeded");
  expect(auto[0]).toMatchObject({ status: "succeeded", method: "card_on_file", source: "autopay" });
  const [charge] = stripe.calls(/^\/v1\/payment_intents$/);
  expect(charge!.body).toMatchObject({ off_session: "true", confirm: "true", amount: "6900" });
  expect(charge!.idempotencyKey).toBe(`rk-charge-${auto[0]!.id}`);
  expect((await mailTo(email, /^Receipt: \$69\.00/, started)).subject).toBeTruthy();

  // FR-BIL-06: the owner refunds it; refund and credit are ledger entries, the invoice stays settled.
  await page.goto(`/billing/invoices/${inv2.id}`);
  await expect(page.getByRole("region", { name: "Card and bank payments" })).toContainText("card on file");
  await page.getByText("Refund this payment").click();
  await page.getByLabel("Refund amount").fill("20.00");
  await page.getByLabel("Reason").last().fill("Missed the garage");
  await page.getByRole("button", { name: "Refund to their card or bank" }).click();
  await expect(page.getByText("Refunded. The money is on its way back to the customer.")).toBeVisible();
  await expectAccessible(page);
  const [refunded] = await payments(inv2.id);
  expect(refunded!.refunded_cents).toBe(2000);
  // The webhook for the same refund arrives too; nothing is posted twice.
  await until(() => Promise.resolve(stripe.delivered.filter((d) => d.type === "refund.created").length), (n) => n === 1);
  const ledger = await until(
    () => adminQuery<{ type: string; amount_cents: number }>("select type, amount_cents from public.ledger_entries where invoice_id = $1 order by occurred_at, type", [inv2.id]),
    (rows) => rows.length >= 4,
  );
  expect(ledger.map((e) => `${e.type} ${e.amount_cents}`).sort()).toEqual(["credit -2000", "invoice 6900", "payment -6900", "refund 2000"]);
  expect((await invoiceFor(second)).status).toBe("paid");
  expect(stripe.calls(/^\/v1\/refunds$/)[0]!.idempotencyKey).toMatch(new RegExp(`^rk-refund-${auto[0]!.id}-`));

  // FR-BIL-04: a card that declines. The invoice waits for the next try in 3 days, and the customer hears.
  await portal.goto(`/p/${day.tenantId}`);
  await portal.getByRole("button", { name: "Use a different card or bank" }).click();
  await portal.getByRole("button", { name: "Save a card that will be declined" }).click();
  await expect(portal.getByText("Autopay is on with Visa ending 0341.")).toBeVisible();
  await until(() => Promise.resolve(stripe.detached.length), (n) => n === 1);
  const inv3 = await finishAndBill(page, third);
  const failed = await until(() => payments(inv3.id), (p) => p[0]?.status === "failed");
  expect(failed[0]).toMatchObject({ status: "failed", source: "autopay" });
  const retry = await invoiceFor(third);
  expect(retry.status).toBe("open");
  expect(retry.autopay_attempts).toBe(1);
  expect(Math.round((retry.autopay_next_at!.getTime() - Date.now()) / 86_400_000)).toBe(3);
  const notice = await mailTo(email, /^Payment didn't go through/, started);
  expect(notice.text).toContain("Not enough funds.");
  expect(notice.text).toMatch(/We'll try again on [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
  await page.goto(`/billing/invoices/${inv3.id}`);
  await expect(page.getByRole("region", { name: "Card and bank payments" })).toContainText("Declined");
  await expect(page.getByRole("region", { name: "Card and bank payments" })).toContainText("Not enough funds");

  // CR-06: the customer turns autopay off; retries stop and Stripe forgets the card.
  await portal.goto(`/p/${day.tenantId}`);
  await portal.getByRole("button", { name: "Turn off autopay" }).click();
  await expect(portal.getByText("Autopay is off. Nothing more will be charged automatically.")).toBeVisible();
  expect((await invoiceFor(third)).autopay_next_at).toBeNull();
  await until(() => Promise.resolve(stripe.detached.length), (n) => n === 2);
  await page.goto(`/customers/${day.customerIds[0]}`);
  await expect(page.getByText("off. The customer turns it on from their account page.")).toBeVisible();

  // FR-BIL-07: the customer paid by bank and the webhook was lost; the nightly check catches up.
  const [pending] = await adminQuery<{ id: string }>(
    "insert into public.payments (tenant_id, customer_id, invoice_id, client_payment_key, method, status, amount_cents, source) values ($1, $2, $3, $4, 'ach', 'processing', 6900, 'portal') returning id",
    [day.tenantId, day.customerIds[0], inv3.id, `lost-${randomUUID()}`],
  );
  stripe.addIntent(acct, { amount: 6900, amount_received: 6900, status: "succeeded", payment_method_types: ["us_bank_account"], metadata: { payment_id: pending!.id, invoice_id: inv3.id, source: "portal" } });
  // And one Stripe took that RouteVerde never wrote down.
  stripe.addIntent(acct, { amount: 4200, amount_received: 4200, status: "succeeded", metadata: { payment_id: randomUUID(), source: "portal" } });
  const cron = await fetch(`${base}/api/cron?job=reconcile`, { method: "POST", headers: { authorization: "Bearer e2e-cron-secret-not-real-1234" } });
  expect(cron.status).toBe(200);
  expect((await payments(inv3.id)).find((p) => p.id === pending!.id)).toMatchObject({ status: "succeeded", method: "ach" });
  expect((await invoiceFor(third)).status).toBe("paid");
  await page.goto("/settings/payments");
  await expect(page.getByText("Payment not on file")).toBeVisible();
  await expect(page.getByText(/Last checked against Stripe/)).toBeVisible();
  await page.getByRole("button", { name: "Mark as sorted" }).first().click();
  await expect(page.getByText("Your payments and Stripe agree.")).toBeVisible();

  // Every money-moving call carried the connected account and a key.
  for (const r of stripe.requests.filter((x) => x.method === "POST" && /^\/v1\/(payment_intents|refunds|checkout\/sessions|customers)$/.test(x.path))) {
    expect(r.account).toBe(acct);
    expect(r.idempotencyKey).toMatch(/^rk-/);
  }
  await customer.close();
});
