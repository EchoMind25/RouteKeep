import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

// Every spec fails on a console error, an uncaught exception or any 5xx
// (replica-test rule), and can run an axe scan for WCAG 2.2 AA (NFR-05).
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`console: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));
      page.on("response", (r) => {
        if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
        // Name the URL behind "Failed to load resource" console errors.
        if (r.status() === 404) problems.push(`HTTP 404 ${r.url()}`);
      });
      await use(problems);
      expect(problems, "console errors, exceptions or 5xx responses").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function signInAs(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.routekeep.test`;
}

/** A fresh business with one technician, one quarterly plan and one customer on it. */
export async function businessWithCustomer(page: Page, opts: { firstName: string; lastName: string }) {
  await signInAs(page, uniqueEmail("biz"));
  await page.getByLabel("Business name").fill(`${opts.lastName} Test Pest`);
  await page.getByLabel("Pesticide business license number").fill("UT-BUS-2002");
  await page.getByLabel("Street address").fill("100 N Main St");
  await page.getByLabel("City").fill("Provo");
  await page.getByLabel("ZIP code").fill("84601");
  await page.getByRole("button", { name: "Create business" }).click();
  await page.waitForURL(/\/setup$/);

  await page.goto("/settings/technicians");
  await page.getByLabel("Name", { exact: true }).fill("Anika Sorensen");
  await page.getByLabel("Applicator license number").fill("UT-APP-1187");
  await page.getByLabel("License expires").fill("2028-04-30");
  await page.getByRole("button", { name: "Add technician" }).click();
  await expect(page.getByText("Anika Sorensen added.")).toBeVisible();

  await page.goto("/settings/plans");
  await page.getByLabel("Plan name").fill("Monthly home protection");
  await page.getByLabel("Price per visit").fill("69");
  await page.getByLabel("How often").selectOption({ label: "Monthly" });
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByText("Monthly home protection created.")).toBeVisible();

  await page.goto("/customers/new");
  await page.getByLabel("First name").fill(opts.firstName);
  await page.getByLabel("Last name").fill(opts.lastName);
  await page.getByLabel("Street address").fill("880 E 300 S");
  await page.getByLabel("City").fill("Orem");
  await page.getByLabel("ZIP").fill("84097");
  await page.getByLabel("Service plan").selectOption({ label: "Monthly home protection: $69.00" });
  await page.getByLabel("Technician").selectOption({ label: "Anika Sorensen" });
  await page.getByLabel("Arrival window starts").fill("08:00");
  await page.getByLabel("Arrival window ends").fill("12:00");
  await page.getByRole("button", { name: "Save and schedule" }).click();
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
  return new URL(page.url()).pathname;
}
