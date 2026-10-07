import { businessWithCustomer, expect, expectAccessible, test } from "./fixtures";

// FR-SUB-03 (this visit / all future, skip, pause, cancel), FR-SUB-04, FR-DSP-02, UX-03.
test("FR-SUB-03: change, skip, restore, pause, resume, cancel and reactivate", async ({ page }) => {
  const customerPath = await businessWithCustomer(page, { firstName: "Thandiwe", lastName: "Montoya" });

  // "This visit only": move the first visit and give it its own window.
  const visits = page.getByRole("region", { name: "Upcoming visits" }).getByRole("link");
  await expect(visits.first()).toBeVisible();
  const upcomingCount = await visits.count();
  await visits.first().click();
  await expect(page).toHaveURL(/\/schedule\/visits\/[0-9a-f-]{36}$/);
  const visitUrl = page.url();
  await expectAccessible(page);
  await page.getByLabel("Window starts").fill("15:00");
  await page.getByLabel("Window ends").fill("17:00");
  await page.getByRole("button", { name: "Save this visit" }).click();
  await expect(page.getByText(/Visit updated/)).toBeVisible();

  // "All future": the hand-arranged visit keeps its own window.
  await page.goto(customerPath);
  await page.getByRole("link", { name: "Monthly home protection" }).click();
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
  await expectAccessible(page);
  await page.getByLabel("Window starts").fill("12:00");
  await page.getByLabel("Window ends").fill("16:00");
  await page.getByLabel("Price per visit").fill("74.50");
  await page.getByRole("button", { name: "Apply to all future visits" }).click();
  await expect(page.getByText(`Saved. ${upcomingCount - 1} ${upcomingCount - 1 === 1 ? "visit follows" : "visits follow"}`)).toBeVisible();
  await page.goto(visitUrl);
  await expect(page.getByText("3:00 PM - 5:00 PM")).toBeVisible();
  await expect(page.getByText("By hand; plan changes leave it alone")).toBeVisible();

  // FR-DSP-02: two people edit the same visit; the second save is refused, not lost silently.
  const other = await page.context().newPage();
  await other.goto(visitUrl);
  await page.getByLabel("Why is it skipped?").fill("Customer not home");
  await page.getByRole("button", { name: "Skip this visit" }).click();
  await expect(page.getByText(/Visit skipped/)).toBeVisible();
  await other.getByLabel("Window starts").fill("09:00");
  await other.getByRole("button", { name: "Save this visit" }).click();
  await expect(other.getByText(/Someone else changed this visit/)).toBeVisible();
  await other.close();

  // UX-03: undo.
  await page.getByRole("button", { name: "Restore visit" }).click();
  await expect(page.getByText("Visit restored.")).toBeVisible();

  // Pause with no end date removes untouched future visits; resume brings them back.
  await page.goto(customerPath);
  await page.getByRole("link", { name: "Monthly home protection" }).click();
  await page.getByLabel("Reason").first().fill("Customer travelling");
  await page.getByRole("button", { name: "Pause plan" }).click();
  await expect(page.getByText(/Plan paused\. \d+ visits? came off the schedule/)).toBeVisible();
  await page.getByRole("button", { name: "Resume now" }).click();
  await expect(page.getByText(/Plan resumed\. \d+ visits? back on the schedule/)).toBeVisible();

  // Cancel shows exactly what will happen, then reactivate.
  await expect(page.getByText(/future visits? will be removed/)).toBeVisible();
  await page.getByRole("region", { name: "Cancel plan" }).getByLabel("Reason").fill("Moved away");
  await page.getByRole("button", { name: "Cancel plan" }).click();
  await expect(page.getByText(/Plan cancelled\./)).toBeVisible();
  await page.getByRole("button", { name: "Reactivate plan" }).click();
  await expect(page.getByText(/Plan reactivated\./)).toBeVisible();
});

test("FR-SUB-04: a one-off visit without a date waits in the needs-attention list", async ({ page }) => {
  const customerPath = await businessWithCustomer(page, { firstName: "Leopold", lastName: "Fonoti" });
  await page.goto(customerPath);
  await page.getByRole("link", { name: "Add a one-off visit" }).click();
  await expectAccessible(page);
  await page.getByLabel("Notes for the technician").fill("Wasps under the deck stairs");
  await page.getByRole("button", { name: "Add visit" }).click();
  await expect(page).toHaveURL(/\/schedule\/visits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Visit without a date" })).toBeVisible();

  await page.goto("/schedule");
  const queue = page.getByRole("region", { name: "Needs attention" });
  await expect(queue.getByText("Leopold Fonoti")).toBeVisible();
  await expect(queue.getByText("Needs a date")).toBeVisible();
});
