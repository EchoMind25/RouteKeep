import { expect, expectAccessible, test } from "./fixtures";

// CR-17: the banner asks once, defaults to essential only, gives both answers
// equal weight, can be reopened, and never asks a browser sending GPC.

test("CR-17: first visit shows the banner; Essential only saves and hides it; Privacy choices reopens it", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Help us improve, anonymously?" });
  await expect(banner).toBeVisible();
  await expectAccessible(page, { include: "section[aria-labelledby=cookie-banner-title]" });
  await banner.getByRole("button", { name: "Essential only" }).click();
  await expect(banner).toBeHidden();
  expect((await context.cookies()).find((c) => c.name === "rv_consent")?.value).toBe("v1.a0.banner");

  await page.reload();
  await expect(banner).toBeHidden();
  await page.getByRole("button", { name: "Privacy choices" }).click();
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Your current choice: essential only");
  await banner.getByRole("button", { name: "Allow anonymous measurement" }).click();
  expect((await context.cookies()).find((c) => c.name === "rv_consent")?.value).toBe("v1.a1.banner");
});

test("CR-17: Global Privacy Control is the answer, so the banner never shows", async ({ page, context }) => {
  await context.clearCookies();
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === "rv_consent")?.value).toBe("v1.a0.gpc");
  await expect(page.getByRole("region", { name: "Help us improve, anonymously?" })).toBeHidden();
  await page.getByRole("button", { name: "Privacy choices" }).click();
  await expect(page.getByRole("button", { name: "Allow anonymous measurement" })).toBeDisabled();
});

test("CR-17, CR-18: the new legal pages are public, indexable and listed", async ({ page, request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/cookies", "/employee-notice"]) {
    expect(sitemap).toContain(`${path}</loc>`);
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
    await expectAccessible(page);
    expect(await page.locator("body").innerText()).not.toMatch(/[–—]/);
  }
});
