import { expect, expectAccessible, signInAs, test } from "./fixtures";

// OPS-01, OPS-02: the developer console. playwright.config.ts puts
// developer@e2e.routeverde.test on DEVELOPER_EMAILS; local sign-in has no second
// factor, so the aal2 rule is covered by lib/auth/developer.test.ts instead.

const DEVELOPER = "developer@e2e.routeverde.test";

test("OPS-01: a developer lands on the console and sees every business, read only", async ({ page }) => {
  await signInAs(page, DEVELOPER);
  await expect(page).toHaveURL(/\/developer$/);
  await expect(page.getByRole("heading", { level: 1, name: "Developer console" })).toBeVisible();

  const businesses = page.getByRole("region", { name: "Businesses" });
  await expect(businesses.getByText("Timpanogos Pest & Lawn (demo)")).toBeVisible();
  await expect(page.getByRole("list", { name: "Health checks" }).getByRole("listitem")).toHaveCount(8);

  // OPS-02: the visit itself is on the activity record.
  const activity = page.getByRole("region", { name: "Developer activity" });
  await expect(activity.getByRole("row").filter({ hasText: DEVELOPER }).filter({ hasText: "console.view" }).first()).toBeVisible();

  // Nothing on the page edits anything.
  await expect(page.locator("main form")).toHaveCount(0);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectAccessible(page);
  }
});

test("OPS-01: anyone else gets a plain not found, and no link to it", async ({ page, problems }) => {
  await signInAs(page, "owner@demo.routeverde.test");
  await expect(page.getByRole("link", { name: "Developer console" })).toHaveCount(0);

  const response = await page.goto("/developer");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Timpanogos Pest & Lawn (demo)")).toHaveCount(0);

  // The 404 is the expected answer here, not a broken page.
  const expected = problems.filter((p) => /HTTP 404 .*\/developer$/.test(p) || /404 \(Not Found\)/.test(p));
  for (const p of expected) problems.splice(problems.indexOf(p), 1);
});

test("OPS-01: signed out, the console sends you to sign in", async ({ page }) => {
  await page.goto("/developer");
  await expect(page).toHaveURL(/\/sign-in$/);
});
