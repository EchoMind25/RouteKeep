import { randomUUID } from "node:crypto";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// M7: legal pages (CR-13), status page (NFR-04), white label theming in the
// office, tech app and portal (FR-BRD-03), and the switch-over checklist (FR-MIG-17).

test("CR-13, NFR-04: legal pages and the status page are public, readable and accessible", async ({ page }) => {
  for (const [path, heading] of [["/terms", "Terms of Service"], ["/privacy", "Privacy Policy"], ["/dpa", "Data Processing Addendum"], ["/subprocessors", "Subprocessors"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectAccessible(page);
  }
  await expect(page.getByRole("region", { name: "Subprocessors" })).toContainText("Anthropic");
  await page.goto("/status");
  await expect(page.getByText("App and database: Working")).toBeVisible();
  await expectAccessible(page);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Privacy" })).toBeVisible();
});

test("FR-BRD-03: white label shows the business's name and colour everywhere, and nothing of ours", async ({ page, browser }) => {
  const day = await seedDispatchDay({ date: denverToday(), techs: ["Rowan Achterberg"], techLogins: [0], stops: [{ name: "Marisol Quintero", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 }] });
  await signInAs(page, day.email);

  // Before: our mark, no colour setting.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Your colour" })).toHaveCount(0);
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rk-accent").trim());

  // The platform switches white label on (npm run white-label) with a pale yellow the app must darken to stay readable.
  await adminQuery("update public.tenants set white_label_at = now(), brand_accent = '#ffd400' where id = $1", [day.tenantId]);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Your colour" })).toBeVisible();
  await expect(page).toHaveTitle(/\| Dispatch Test Pest$/);
  const aside = page.locator("aside").first();
  await expect(aside).toContainText("Dispatch Test Pest");
  await expect(aside).not.toContainText("RouteVerde");
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rk-accent").trim());
  expect(accent).not.toBe(before);
  expect(accent).not.toBe("#ffd400");
  await expectAccessible(page);

  // The owner picks a deeper colour.
  await page.getByRole("textbox", { name: "Brand colour" }).fill("#0b3d2e");
  await page.getByRole("button", { name: "Save colour" }).click();
  await expect(page.getByText(/^Colour saved/)).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rk-accent").trim())).toBe("#0b3d2e");

  // The tech app shows the business, not the product.
  const phone = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  await tech.goto("/tech");
  await expect(tech.locator("header").first()).toContainText("Dispatch Test Pest", { timeout: 15_000 });
  await expect(tech.locator("header").first()).not.toContainText("RouteVerde");
  await phone.close();

  // The portal drops the product credit.
  await page.goto(`/p/${day.tenantId}`);
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await expect(page.getByText("Powered by")).toHaveCount(0);
});

test("FR-MIG-17: the switch-over checklist tracks real progress", async ({ page }) => {
  const day = await seedDispatchDay({ date: denverToday(), techs: ["Rowan Achterberg"], techLogins: [0], stops: [] });
  await signInAs(page, day.email);
  await page.goto("/setup");
  const list = page.getByRole("list", { name: "Switch-over checklist" });
  await expect(list.getByRole("listitem").filter({ hasText: "Invite your technicians" })).toContainText("(done)");
  await expect(list.getByRole("listitem").filter({ hasText: "Go live" })).toContainText("(to do)");
  await expectAccessible(page);
  await page.goto("/settings/messages");
  // Go live shows only with imported customers; record one.
  await adminQuery(`insert into public.import_jobs (id, tenant_id, source, status) values ($1, $2, 'csv', 'reconciled')`, [randomUUID(), day.tenantId]);
  await adminQuery(
    `insert into public.customers (tenant_id, display_name, import_job_id, source, external_ref) select $1, 'Imported Ivy', id, 'csv', 'x1' from public.import_jobs where tenant_id = $1`,
    [day.tenantId],
  );
  await page.reload();
  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.getByText(/^Live since/)).toBeVisible();
  await page.goto("/setup");
  await expect(list.getByRole("listitem").filter({ hasText: "Go live" })).toContainText("(done)");
});
