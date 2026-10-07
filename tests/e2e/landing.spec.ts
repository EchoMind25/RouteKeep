import { expect, expectAccessible, test } from "./fixtures";

// FR-WEB-01, FR-WEB-02: the public landing page, its search files, and the
// short way into the app.

test("FR-WEB-01: the landing page renders, is accessible and describes itself to search engines @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pest control software that works offline.");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/[^/]+\/?$/);
  await expectAccessible(page);

  // Structured data matches what the page says.
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const data = JSON.parse(blocks[0]!) as { "@type": string; offers?: { price: string }[]; mainEntity?: { name: string }[] }[];
  const app = data.find((d) => d["@type"] === "SoftwareApplication")!;
  expect(app.offers!.map((o) => o.price)).toEqual(["79.00", "179.00", "349.00", "5000.00"]);
  const faq = data.find((d) => d["@type"] === "FAQPage")!;
  await expect(page.locator("#faq summary")).toHaveCount(faq.mainEntity!.length);

  // No em or en dashes anywhere a visitor can read.
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/[–—]/);

  // A FAQ answer opens.
  await page.getByText("Does the technician app work without cell service?").click();
  await expect(page.getByText(/The whole day lives on the phone/)).toBeVisible();
});

test("FR-WEB-01: robots, sitemap and llms.txt keep the app private and describe the product", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /schedule");
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>");
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toContain("$79.00 a month");
  expect(llms).toContain("White label: $5,000.00 one time");
  const card = await request.get("/opengraph-image");
  expect(card.headers()["content-type"]).toBe("image/png");
});

test("FR-WEB-02: /login and /app lead to sign-in when signed out", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});
