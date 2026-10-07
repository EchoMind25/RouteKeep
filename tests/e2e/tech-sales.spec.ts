import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// FR-SAL-01..04: the owner turns on technician sales with a commission rule; a
// technician adds a customer with a plan from the field and sees what it
// earns; the office approves and pays it; the amount cannot be edited.

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

test("FR-SAL-01..04: a technician sells a plan in the field and the office pays the commission", async ({ page, browser }) => {
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Rowan Achterberg"],
    techLogins: [0],
    stops: [{ name: "Existing Household", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 }],
  });
  await adminQuery(
    `insert into public.service_plans (tenant_id, service_type_id, name, price_cents, initial_price_cents, rrule)
     select $1, id, 'Field quarterly', 12900, 19900, 'FREQ=MONTHLY;INTERVAL=3' from public.service_types where tenant_id = $1 and category = 'pest' limit 1`,
    [day.tenantId],
  );

  // Off by default: the technician app offers nothing and the page says so.
  const phone = await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  await expect(tech.getByText(/Rowan Achterberg, 1 stop/)).toBeVisible();
  await expect(tech.getByRole("link", { name: "New customer" })).toHaveCount(0);
  await tech.goto("/sales/new");
  await expect(tech.getByText("Your office has not turned on adding customers from the field.")).toBeVisible();

  // The owner turns it on: $25 flat plus 10% of the first service.
  await signInAs(page, day.email);
  await page.goto("/settings/sales");
  await page.getByLabel("Technicians can add customers").check();
  await page.getByLabel("Flat amount").fill("25");
  await page.getByLabel("Percent of first service").fill("10");
  await expect(page.getByText("A sale of Field quarterly would earn $44.90.")).toBeVisible();
  await page.getByRole("button", { name: "Save sales settings" }).click();
  await expect(page.getByText(/^Saved\. Changes apply to sales made from now on/)).toBeVisible();
  await expectAccessible(page);

  // The technician's app picks it up on its next sync.
  await tech.goto("/tech");
  await tech.getByRole("button", { name: /All saved on this phone/ }).click();
  await tech.getByRole("link", { name: "New customer" }).click();
  await expect(tech.getByRole("heading", { name: "New customer", level: 1 })).toBeVisible();
  await tech.getByLabel("First name").fill("Priya");
  await tech.getByLabel("Last name").fill("Fieldsale");
  await tech.getByLabel("Mobile phone").fill("801-555-0199");
  await tech.getByLabel("Street address").fill("88 W Field St");
  await tech.getByLabel("City").fill("Orem");
  await tech.getByLabel("ZIP").fill("84057");
  await tech.getByLabel("Service plan").selectOption({ label: "Field quarterly: $129.00" });
  await expect(tech.getByLabel("Technician")).toHaveCount(0);
  await expect(tech.getByText("Your commission: $44.90")).toBeVisible();
  await expectAccessible(tech);
  await tech.getByRole("button", { name: "Save and schedule" }).click();
  await expect(tech.getByText("Customer added. Your commission is waiting for the office to approve it.")).toBeVisible();
  const sale = tech.getByRole("list", { name: "Sales" }).getByRole("listitem");
  await expect(sale).toHaveCount(1);
  await expect(sale).toContainText("Priya Fieldsale");
  await expect(sale).toContainText("$44.90");
  await expect(sale).toContainText("Waiting for approval");
  await expectAccessible(tech);

  const [saved] = await adminQuery<{ sold_by: string; amount: number; visits: number; source: string }>(
    `select c.sold_by_technician_id as sold_by, k.amount_cents as amount, c.sms_consent_source as source,
            (select count(*)::int from public.appointments a where a.customer_id = c.id) as visits
     from public.customers c join public.commissions k on k.customer_id = c.id where c.tenant_id = $1 and c.display_name = 'Priya Fieldsale'`,
    [day.tenantId],
  );
  expect(saved).toMatchObject({ sold_by: day.techIds[0], amount: 4490 });
  expect(saved!.visits).toBeGreaterThan(0);

  // The office sees who sold it, approves, then pays.
  await page.goto("/reports/commissions");
  const row = page.getByRole("row").filter({ hasText: "Priya Fieldsale" });
  await expect(row).toContainText("Rowan Achterberg");
  await expect(row).toContainText("$25.00 flat + 10% of $199.00");
  await expectAccessible(page);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved.", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByText("Marked paid.", { exact: true })).toBeVisible();
  await expect(row.getByText("Paid", { exact: true })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  await row.getByRole("link", { name: "Priya Fieldsale" }).click();
  await expect(page.getByText("Rowan Achterberg, $44.90 commission (paid)")).toBeVisible();

  // CSV for payroll.
  const csv = (await (await page.request.get(`/api/reports/commissions?from=${today}&to=${today}`)).body()).toString("utf8");
  expect(csv).toContain("Rowan Achterberg,Priya Fieldsale,Field quarterly,199.00,25.00,10,44.90,Paid");

  // The technician sees it paid.
  await tech.goto("/sales");
  await expect(sale).toContainText("Paid");
  // And cannot read the office report.
  expect((await tech.request.get(`/api/reports/commissions?from=${today}&to=${today}`)).status()).toBe(403);
  await phone.close();
});
