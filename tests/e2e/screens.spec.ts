import { expect, expectAccessible, OFFICE_SCREENS, signInAs, test } from "./fixtures";

// Every built screen renders for the demo business without errors and passes
// an axe WCAG 2.2 AA scan (NFR-05). Needs `npm run db:reset` (demo seed).

test("office screens render and are accessible @mobile", async ({ page }) => {
  await signInAs(page, "owner@demo.routeverde.test");
  for (const path of OFFICE_SCREENS) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
  }
  await page.goto("/customers");
  await page.locator("table a").first().click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await expectAccessible(page);
});

test("technicians land on their own day @mobile", async ({ page }) => {
  await signInAs(page, "tech.dez@demo.routeverde.test");
  await expect(page).toHaveURL(/\/tech$/);
  await expect(page.getByText(/Dez Whitlock, \d+ stops?/)).toBeVisible();
  await expectAccessible(page);
  // Technicians cannot open office screens.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/tech$/);
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  for (const path of ["/schedule", "/customers", "/settings", "/tech"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});
