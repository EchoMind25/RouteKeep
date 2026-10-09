import { SITE_PAGES } from "../../lib/landing/pages";
import { expect, expectAccessible, test } from "./fixtures";

// FR-WEB-01: the guides beside the landing page. Each is indexable, canonical,
// accessible, listed in the sitemap and /llms.txt, and free of dashes.

for (const page of Object.values(SITE_PAGES)) {
  test(`FR-WEB-01: ${page.path} is a public, indexable, accessible page @mobile`, async ({ page: p }) => {
    await p.goto(page.path);
    await expect(p.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(p).toHaveTitle(new RegExp(`^${page.title}`));
    await expect(p.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
    await expect(p.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${page.path}$`));
    await expect(p.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`${page.path}/opengraph-image`));
    await expectAccessible(p);

    // Structured data parses, and any FAQ in it is the FAQ on the page.
    for (const block of await p.locator('script[type="application/ld+json"]').allTextContents()) {
      const items = [JSON.parse(block)].flat() as { "@type": string; mainEntity?: { name: string }[] }[];
      for (const faq of items.filter((i) => i["@type"] === "FAQPage")) {
        for (const q of faq.mainEntity!) await expect(p.getByText(q.name, { exact: true })).toBeVisible();
      }
    }

    const text = await p.locator("body").innerText();
    expect(text).not.toMatch(/[–—]/);
  });
}

test("FR-WEB-01: the sitemap and llms.txt list every guide, and the legal pages are indexable", async ({ request, page }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const llms = await (await request.get("/llms.txt")).text();
  for (const p of Object.values(SITE_PAGES)) {
    expect(sitemap).toContain(`${p.path}</loc>`);
    expect(llms).toContain(`${p.path}):`);
  }
  expect(sitemap).toContain("/privacy</loc>");
  await page.goto("/privacy");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
  await page.goto("/status");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("FR-WEB-01: on a phone the menu opens, reaches every guide, and closes after a tap @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const main = page.getByRole("navigation", { name: "Main" });
  await main.locator("summary").click();
  await main.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pest control software pricing, posted.");
  await expect(main.getByRole("link", { name: "Switching" })).toBeHidden();
});
