import { randomUUID } from "node:crypto";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import { linkIn, mailTo } from "./mail";

// FR-MSG-01 "on the way" from the tech app, FR-BIL-05 receipts, FR-MIG-18 the
// switch-over notice.

test("on my way, a receipt, and the new-account notice reach the customer once each", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const started = Date.now();
  const today = denverToday();
  const day = await seedDispatchDay({ date: today, techs: ["Rowan Achterberg"], techLogins: [0], stops: [{ name: "Marisol Quintero", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 }] });
  const [stop] = day.stopIds as [string];
  const email = `notices-${randomUUID().slice(0, 8)}@example.com`;
  await adminQuery("update public.customers set email = $2, first_name = 'Marisol' where id = $1", [day.customerIds[0], email]);
  await adminQuery("update public.appointments set price_cents = 6900 where id = $1", [stop]);

  // The technician taps On my way; it is queued like any other action.
  const phone = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  await tech.goto("/tech");
  await tech.getByRole("button", { name: /Stop 1: Marisol Quintero/ }).click();
  await tech.getByRole("button", { name: "On my way" }).click();
  await expect(tech.getByText("The customer will get an on-the-way email.")).toBeVisible();
  const way = await mailTo(email, /is on the way$/, started);
  expect(way.subject).toBe("Rowan Achterberg is on the way");
  // Once arrived, the button is gone.
  await tech.getByRole("button", { name: "Arrive and start" }).click();
  await phone.close();

  // The office records a check; a receipt follows.
  await adminQuery("update public.appointments set status = 'completed', completed_at = now() where id = $1", [stop]);
  await signInAs(page, day.email);
  await page.goto("/billing");
  await page.getByRole("button", { name: "Invoice finished visits" }).click();
  await expect(page.getByText("1 invoice made, 0 payments posted.")).toBeVisible();
  await page.getByRole("region", { name: "Invoices" }).getByRole("link", { name: /^#\d+$/ }).click();
  await page.getByRole("radio", { name: "Check" }).check();
  await page.getByLabel("Check number").fill("1042");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  const receipt = await mailTo(email, /^Receipt: \$69\.00/, started);
  expect(receipt.text).toContain("We received $69.00 by check #1042 for invoice");
  expect(receipt.text).toContain("Your balance is now $0.00.");

  // The switch-over notice: once per customer, however often it is sent.
  await page.goto("/settings/messages");
  await expectAccessible(page);
  await page.getByLabel(/Your note/).fill("We moved to a new system. Same crew, same schedule.");
  await page.getByRole("button", { name: "Email 1 customer" }).click();
  await expect(page.getByText(/^Queued for 1 customer/)).toBeVisible();
  const notice = await mailTo(email, /has a new home$/, started);
  expect(notice.text).toContain("We moved to a new system. Same crew, same schedule.");
  expect(linkIn(notice.text, /https?:\/\/\S+\/p\/[0-9a-f-]{36}/)).toBe(`/p/${day.tenantId}`);
  await page.getByRole("button", { name: "Email 1 customer" }).click();
  await expect(page.getByText(/^Queued for 1 customer/)).toBeVisible();
  const [count] = await adminQuery<{ n: number }>("select count(*)::int as n from public.outbox_events where tenant_id = $1 and topic = 'customer.switch_notice'", [day.tenantId]);
  expect(count!.n).toBe(1);
});
