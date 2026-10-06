import { expect, expectAccessible, signInAs, test, uniqueEmail } from "./fixtures";

// F01 / FR-SET-01: a new owner reaches a usable, empty schedule.
test("FR-SET-01: a new owner creates a business and lands on setup", async ({ page }) => {
  await signInAs(page, uniqueEmail("owner"));
  await expect(page).toHaveURL(/\/onboarding$/);
  await expectAccessible(page);

  // Validation keeps what was typed.
  await page.getByLabel("Business name").fill("Bonneville Bug & Lawn");
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByText("Check the highlighted fields.")).toBeVisible();
  await expect(page.getByLabel("Business name")).toHaveValue("Bonneville Bug & Lawn");
  await expect(page.getByText("License number is required")).toBeVisible();

  await page.getByLabel("Pesticide business license number").fill("UT-BUS-88213");
  await page.getByLabel("Street address").fill("455 W 200 S");
  await page.getByLabel("City").fill("Salt Lake City");
  await page.getByLabel("ZIP code").fill("84101");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Get set up" })).toBeVisible();
  await expect(page.getByText("4 of 5 steps left")).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Go to schedule" }).click();
  await expect(page.getByRole("heading", { name: "Nothing scheduled yet" })).toBeVisible();
});
