import { businessWithCustomer, expect, expectAccessible, test } from "./fixtures";

// FR-CRM-01 (edit, multiple properties), FR-CRM-04 / CR-07 (consent history), ENG-07.
test("FR-CRM-01: edit a customer, withdraw text consent, add a second address", async ({ page }) => {
  const customerPath = await businessWithCustomer(page, { firstName: "Esperanza", lastName: "Kowalczyk" });

  await page.getByRole("region", { name: "Contact" }).getByRole("link", { name: "Edit" }).click();
  await expectAccessible(page);
  await page.getByLabel("Mobile phone").fill("385-555-0177");
  await page.getByLabel("Customer agrees to text messages").check();
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByText("Customer saved.")).toBeVisible();
  await expect(page.getByText("(385) 555-0177")).toBeVisible();
  await expect(page.getByText(/Consent recorded/)).toBeVisible();

  // Withdrawing consent records an opt-out; it does not erase the grant.
  await page.getByRole("region", { name: "Contact" }).getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Customer agrees to text messages").uncheck();
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByText("Opted out")).toBeVisible();

  // A stale form is refused rather than overwriting someone else's change.
  await page.getByRole("region", { name: "Contact" }).getByRole("link", { name: "Edit" }).click();
  const stale = await page.context().newPage();
  await stale.goto(page.url());
  await page.getByLabel("Last name").fill("Kowalczyk-Ruiz");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("heading", { name: "Esperanza Kowalczyk-Ruiz" })).toBeVisible();
  await stale.getByLabel("First name").fill("Espe");
  await stale.getByRole("button", { name: "Save customer" }).click();
  await expect(stale.getByText(/Someone else changed this customer/)).toBeVisible();
  await stale.close();

  // Second property (FR-CRM-01).
  await page.goto(customerPath);
  await page.getByRole("link", { name: "Add address" }).click();
  await expectAccessible(page);
  await page.getByLabel("Street address").fill("455 W Center St");
  await page.getByLabel("City").fill("Springville");
  await page.getByLabel("ZIP").fill("84663");
  await page.getByLabel("Lawn square feet").fill("6200");
  await page.getByRole("button", { name: "Add address" }).click();
  await expect(page.getByText("Address added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Properties" }).getByText("455 W Center St, Springville, UT 84663", { exact: true })).toBeVisible();
});
