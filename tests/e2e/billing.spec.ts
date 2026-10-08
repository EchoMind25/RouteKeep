import { randomUUID } from "node:crypto";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import { pdfText } from "./pdf";

// M4 stage 1: FR-BIL-01 (invoices per visit and per period), FR-BIL-03 (each
// invoice its own step, reruns safe), FR-BIL-04 (collections), FR-BIL-06
// (payments, credits and voids as ledger entries), FR-BIL-08 (money reports),
// FR-BRD-01/02 (the business's logo on invoices, nothing of ours).

const minusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
// A 1x1 PNG, enough to stand in for a logo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("M4: finished visits are invoiced once, field cash applied, payments, credits and voids post to the ledger", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const today = denverToday();
  // Comfortably inside last month, whatever today is.
  const lastMonth = minusDays(`${today.slice(0, 8)}01`, 10);
  const day = await seedDispatchDay({
    date: today,
    techs: ["Rowan Achterberg"],
    techLogins: [0],
    stops: [
      { name: "Cash At The Door", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 },
      { name: "Pays Later", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0 },
      { name: "Billed Monthly", lat: OFFICE.lat, lng: OFFICE.lng + 0.03, tech: 0, date: lastMonth },
    ],
  });
  const [cash, later, monthly] = day.stopIds as [string, string, string];
  await adminQuery("update public.appointments set price_cents = 6900 where id = $1", [cash]);
  await adminQuery("update public.appointments set price_cents = 12900 where id = $1", [later]);
  // The third visit belongs to a plan billed monthly, finished last month.
  await adminQuery(
    `with a as (select * from public.appointments where id = $1),
          p as (insert into public.service_plans (tenant_id, service_type_id, name, price_cents, rrule, billing_mode)
                select tenant_id, service_type_id, 'Monthly mosquito', 4500, 'FREQ=MONTHLY', 'monthly' from a returning id),
          s as (insert into public.subscriptions (tenant_id, customer_id, property_id, plan_id, service_type_id, start_date, rrule, price_cents, billing_mode)
                select a.tenant_id, a.customer_id, a.property_id, p.id, a.service_type_id, a.local_date, 'FREQ=MONTHLY', 4500, 'monthly' from a, p returning id)
     update public.appointments set subscription_id = (select id from s), occurrence_date = local_date, price_cents = 4500,
       status = 'completed', arrived_at = now() - interval '30 days', completed_at = now() - interval '30 days' where id = $1`,
    [monthly],
  );

  // The technician finishes two stops; at the first the customer pays $69 cash.
  const phone = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  const at = new Date().toISOString();
  const finish = (id: string, payment: object) => ({ kind: "complete", key: `complete-${randomUUID()}`, appointmentId: id, date: today, at, applications: [], checklist: [], notes: null, payment });
  const sent = await tech.request.post("/api/tech/upload", {
    data: { protocol: 1, mutations: [finish(cash, { method: "cash", key: `pay-${randomUUID()}`, amountCents: 6900 }), finish(later, { method: "invoice_later" })] },
  });
  expect(((await sent.json()) as { results: { status: string }[] }).results.map((r) => r.status)).toEqual(["applied", "applied"]);
  await phone.close();

  // The office uploads its logo, then bills.
  await signInAs(page, day.email);
  await page.goto("/settings");
  await page.getByLabel("Logo file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "Logo you picked, not saved yet" })).toBeVisible();
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Logo saved. Every invoice from now on shows it.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Your current logo" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Logo you picked, not saved yet" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Billing" }).click();
  await page.getByRole("button", { name: "Invoice finished visits" }).click();
  await expect(page.getByText("3 invoices made, 1 payment posted.")).toBeVisible();
  // A second run finds nothing new (FR-BIL-03).
  await page.getByRole("button", { name: "Invoice finished visits" }).click();
  await expect(page.getByText("0 invoices made, 0 payments posted.")).toBeVisible();
  await expectAccessible(page);

  const open = page.getByRole("region", { name: "Invoices" });
  await expect(open.getByRole("row").filter({ hasText: "Pays Later" })).toContainText("$129.00");
  await expect(open.getByRole("row").filter({ hasText: "Billed Monthly" })).toContainText("$45.00");
  await expect(open.getByRole("row").filter({ hasText: "Cash At The Door" })).toHaveCount(0);
  await page.getByRole("link", { name: "Paid", exact: true }).click();
  await expect(open.getByRole("row").filter({ hasText: "Cash At The Door" })).toContainText("Paid");

  const invoices = await adminQuery<{ name: string; period_key: string; lines: number }>(
    `select c.display_name as name, i.period_key, (select count(*)::int from public.invoice_lines l where l.invoice_id = i.id) as lines
     from public.invoices i join public.customers c on c.id = i.customer_id where i.tenant_id = $1 order by c.display_name`,
    [day.tenantId],
  );
  expect(invoices.find((i) => i.name === "Billed Monthly")!.period_key).toBe(lastMonth.slice(0, 7));

  // Pay part by check, credit some, refuse an overpayment, pay the rest in cash.
  await page.getByRole("link", { name: "Open", exact: true }).click();
  await open.getByRole("row").filter({ hasText: "Pays Later" }).getByRole("link", { name: /^#\d+$/ }).click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("129.00");
  await expectAccessible(page);
  await page.getByRole("radio", { name: "Check" }).check();
  await page.getByLabel("Amount", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Enter the check number")).toBeVisible();
  await page.getByLabel("Check number").fill("1042");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await page.getByLabel("Credit amount").fill("9");
  await page.getByLabel("Reason").fill("Missed the garage, as agreed");
  await page.getByRole("button", { name: "Apply credit" }).click();
  await expect(page.getByText("Credit applied.")).toBeVisible();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("70.00");
  await page.getByLabel("Amount", { exact: true }).fill("75");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/That is more than the invoice still owes/)).toBeVisible();
  await page.getByLabel("Amount", { exact: true }).fill("70");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Summary" }).getByText("Paid", { exact: true })).toBeVisible();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await expect(history).toContainText("check #1042");
  await expect(history).toContainText("Missed the garage, as agreed");

  // The PDF carries the business's logo and nothing of ours (FR-BRD-01).
  const pdfUrl = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfUrl!);
  const raw = (await pdf.body()).toString("latin1");
  const text = pdfText(await pdf.body());
  expect(text).toContain("Dispatch Test Pest");
  expect(text).toContain("Paid in full. Thank you.");
  expect(raw).toContain("/Subtype /Image");
  expect(raw + text).not.toContain("RouteVerde");

  // Void the monthly invoice (made in error): history keeps it, balance clears.
  await page.goto("/billing");
  await open.getByRole("row").filter({ hasText: "Billed Monthly" }).getByRole("link", { name: /^#\d+$/ }).click();
  await page.getByLabel("Why void it").fill("Plan was sold by mistake");
  await page.getByRole("button", { name: "Void invoice" }).click();
  await expect(page.getByText("Invoice voided. It stays on file with the reason.")).toBeVisible();

  const [ledger] = await adminQuery<{ balance: number; entries: number }>(
    "select coalesce(sum(amount_cents), 0)::int as balance, count(*)::int as entries from public.ledger_entries where tenant_id = $1",
    [day.tenantId],
  );
  // 3 invoices, field cash, check, credit, cash, void credit.
  expect(ledger).toEqual({ balance: 0, entries: 8 });

  // An overdue invoice shows up in collections, oldest first.
  await adminQuery(
    `update public.appointments set status = 'completed', price_cents = 8800, arrived_at = now(), completed_at = now() where id = $1`,
    [cash],
  );
  const extra = await adminQuery<{ id: string }>(
    `insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, technician_id, status, local_date, tz, duration_min, price_cents, arrived_at, completed_at)
     select tenant_id, customer_id, property_id, service_type_id, technician_id, 'completed', $2::date, tz, 30, 8800, now(), now() from public.appointments where id = $1 returning id`,
    [later, minusDays(today, 1)],
  );
  await page.goto("/billing");
  await page.getByRole("button", { name: "Invoice finished visits" }).click();
  await expect(page.getByText("1 invoice made, 0 payments posted.")).toBeVisible();
  await adminQuery("update public.invoices set due_date = $2::date - 45 where id = (select invoice_id from public.invoice_lines where appointment_id = $1)", [extra[0]!.id, today]);
  await page.getByRole("navigation", { name: "Billing sections" }).getByRole("link", { name: "Collections" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Pays Later" })).toContainText("31 to 60 days late");
  await expect(page.getByRole("row").filter({ hasText: "Pays Later" })).toContainText("$88.00");
  await expectAccessible(page);

  // Money reports.
  await page.goto(`/reports/billing?from=${lastMonth}&to=${today}`);
  await expect(page.getByRole("heading", { name: "Money owed: $88.00" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Production by technician" }).getByRole("row").filter({ hasText: "Rowan Achterberg" })).toBeVisible();
  await expectAccessible(page);
});
