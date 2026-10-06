import { expect, expectAccessible, signInAs, test, uniqueEmail } from "./fixtures";

// F02 / FR-SET-02..04, FR-CRM-01, FR-SUB-01, FR-SUB-02, UX-02: from an empty
// business to a customer whose visits are on the schedule, in three screens.
test("FR-SUB-01: sell a plan and see its visits on the schedule", async ({ page }) => {
  await signInAs(page, uniqueEmail("seller"));
  await page.getByLabel("Business name").fill("Wasatch Test Pest");
  await page.getByLabel("Pesticide business license number").fill("UT-BUS-1001");
  await page.getByLabel("Street address").fill("100 N Main St");
  await page.getByLabel("City").fill("Provo");
  await page.getByLabel("ZIP code").fill("84601");
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page).toHaveURL(/\/setup$/);

  // Technician (FR-SET-02): the license is required.
  await page.goto("/settings/technicians");
  await page.getByLabel("Name", { exact: true }).fill("Dez Whitlock");
  await page.getByRole("button", { name: "Add technician" }).click();
  await expect(page.getByText("Applicator license number is required")).toBeVisible();
  await page.getByLabel("Applicator license number").fill("UT-APP-1031");
  await page.getByLabel("License expires").fill("2028-04-30");
  await page.getByRole("button", { name: "Add technician" }).click();
  await expect(page.getByText("Dez Whitlock added.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "UT-APP-1031" })).toBeVisible();
  await expectAccessible(page);

  // Plan (FR-SET-04).
  await page.goto("/settings/plans");
  await page.getByLabel("Plan name").fill("Quarterly home protection");
  await page.getByLabel("Price per visit").fill("129");
  await page.getByLabel("First visit price").fill("199.00");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByText("Quarterly home protection created.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Every 3 months \(quarterly\)/ })).toBeVisible();

  // Product (FR-SET-03): pesticides need their EPA number.
  await page.goto("/settings/products");
  await page.getByLabel("Brand name").fill("Sample Perimeter Concentrate");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Registered pesticides need their EPA registration number")).toBeVisible();
  await page.getByLabel("EPA registration number").fill("0-555");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Sample Perimeter Concentrate added.")).toBeVisible();

  // Customer + property + plan on one screen (UX-02).
  await page.goto("/customers/new");
  await page.getByLabel("First name").fill("Juniper");
  await page.getByLabel("Last name").fill("Fairbanks");
  await page.getByLabel("Mobile phone").fill("(801) 555-0142");
  await page.getByLabel("Customer agreed to text messages").check();
  await page.getByLabel("Street address").fill("2710 E 1500 N");
  await page.getByLabel("City").fill("Provo");
  await page.getByLabel("ZIP").fill("84604");
  await page.getByLabel("Service plan").selectOption({ label: "Quarterly home protection: $129.00" });
  await expect(page.getByText("Every 3 months (quarterly)")).toBeVisible();
  const firstVisit = await page.getByLabel("First visit").inputValue();
  await page.getByLabel("Technician").selectOption({ label: "Dez Whitlock" });
  await page.getByLabel("Arrival window starts").fill("08:00");
  await page.getByLabel("Arrival window ends").fill("12:00");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Save and schedule" }).click();

  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByRole("heading", { name: "Juniper Fairbanks" })).toBeVisible();
  await expect(page.getByText(/upcoming visits? (is|are) on the schedule/)).toBeVisible();
  await expect(page.getByText("First visit").first()).toBeVisible();
  await expect(page.getByText("$199.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Consent recorded")).toBeVisible();
  await expectAccessible(page);

  // The first visit is on that day's schedule in Dez's lane.
  await page.goto(`/schedule?date=${firstVisit}`);
  const lane = page.getByRole("region", { name: "Dez Whitlock" });
  await expect(lane.getByRole("link", { name: "Juniper Fairbanks" })).toBeVisible();
  await expect(lane.getByText("8:00 AM - 12:00 PM")).toBeVisible();
  await expectAccessible(page);
});
