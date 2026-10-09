import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, OFFICE_SCREENS, signInAs, test } from "./fixtures";
import { linkIn, mailTo } from "./mail";

// NFR-05: WCAG 2.2 AA beyond the default light theme. Dark mode follows the
// system setting, the technician app has an outdoor high-contrast theme
// (FR-TEC-11), and motion is reduced as people ask. Open dialogs, menus and
// form errors are scanned too, and two flows are driven by keyboard alone.

test.use({ colorScheme: "dark", reducedMotion: "reduce" });

const DAY = "2030-03-12";

/** Press Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator, max = 150) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

async function signInAsKeyboard(page: Page, email: string) {
  await page.goto("/sign-in");
  await tabTo(page, page.getByLabel("Work email"));
  await page.keyboard.type(email);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

test("NFR-05: office screens pass axe in dark mode with reduced motion", async ({ page }) => {
  await signInAs(page, "owner@demo.routeverde.test");
  for (const path of OFFICE_SCREENS) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
  }
});

test("NFR-05: an office form error state passes axe, names each field and takes focus (light and dark)", async ({ page }) => {
  await signInAs(page, "owner@demo.routeverde.test");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/customers/new");
    await page.getByRole("button", { name: "Save customer" }).click();
    await expect(page.locator("form").getByRole("alert")).toBeVisible();
    const street = page.getByLabel("Street address");
    await expect(street).toHaveAttribute("aria-invalid", "true");
    await expect(street).toHaveAccessibleDescription(/required/i);
    await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
    await expectAccessible(page);
  }
});

test("NFR-05, FR-DSP-03: the board and its open dialog pass axe in dark mode", async ({ page }) => {
  const day = await seedDispatchDay({
    date: DAY,
    techs: ["Anika Sorensen"],
    stops: [3, 1, 2].map((k) => ({ name: `East ${k}`, lat: OFFICE.lat, lng: OFFICE.lng + 0.012 * k, tech: 0 })),
  });
  await signInAs(page, day.email);
  await page.goto(`/schedule?date=${DAY}`);
  await page.getByRole("region", { name: "Map of the day's stops" }).locator("canvas").waitFor();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Optimize Anika Sorensen's route" }).click();
  const dialog = page.getByRole("dialog", { name: "Optimize Anika Sorensen" });
  await expect(dialog.getByText("Driving now")).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Optimize Anika Sorensen's route" })).toBeFocused();
});

test("NFR-05, WCAG 2.5.7, FR-DSP-02: the Move stop menu works by keyboard alone and focus returns", async ({ page }) => {
  const day = await seedDispatchDay({
    date: DAY,
    techs: ["Anika Sorensen"],
    stops: [1, 2, 3].map((k) => ({ name: `East ${k}`, lat: OFFICE.lat, lng: OFFICE.lng + 0.012 * k, tech: 0 })),
  });
  await signInAsKeyboard(page, day.email);
  await page.goto(`/schedule?date=${DAY}`);
  await page.getByRole("region", { name: "Map of the day's stops" }).locator("canvas").waitFor();
  const anika = page.getByRole("region", { name: "Anika Sorensen", exact: true });
  await expect(anika.getByRole("button", { name: "Stop 1: show East 1 on the map" })).toBeVisible();

  // Open, then Escape: nothing moves and focus is back on the trigger.
  const trigger = anika.getByRole("button", { name: "Move stop 1" });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move down" })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Open, arrow to "Move down", Enter: the stop moves and focus follows it.
  await page.keyboard.press("Enter");
  const down = menu.getByRole("menuitem", { name: "Move down" });
  for (let i = 0; i < 5 && !(await down.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
  await expect(down).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(anika.getByRole("button", { name: "Stop 2: show East 1 on the map" })).toBeVisible();
  await expect(anika.getByRole("button", { name: "Move stop 2" })).toBeFocused();
});

test("NFR-05, FR-TEC-03, FR-TEC-07, FR-TEC-11: a technician completes a stop by keyboard alone; outdoor and dark pass axe", async ({ page }) => {
  test.setTimeout(120_000);
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Dez Whitlock"],
    techLogins: [0],
    products: [{ name: "Demo Perimeter Concentrate" }],
    stops: [{ name: "Keyboard Customer", lat: OFFICE.lat + 0.004, lng: OFFICE.lng, tech: 0 }],
  });
  await signInAsKeyboard(page, day.techEmails[0]!);
  await expect(page).toHaveURL(/\/tech$/);
  await expect(page.getByText("Dez Whitlock, 1 stop, 0 done")).toBeVisible();
  // Dark mode first (the test runs with a dark system setting).
  await expectAccessible(page);

  // Settings dialog, by keyboard: turn on outdoor mode.
  await tabTo(page, page.getByRole("button", { name: "Settings" }));
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expectAccessible(page);
  const outdoor = settings.getByRole("button", { name: /Outdoor mode/ });
  await tabTo(page, outdoor);
  await page.keyboard.press("Space");
  await expect(outdoor).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "outdoor");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expectAccessible(page);

  // The stop, step by step. Each step moves focus to its heading.
  await tabTo(page, page.getByRole("button", { name: /^Stop 1: Keyboard Customer/ }));
  await page.keyboard.press("Enter");
  await expectAccessible(page);
  await tabTo(page, page.getByRole("button", { name: /^(Arrive and start|Continue)$/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /step 1 of/ })).toBeFocused();

  await tabTo(page, page.getByRole("button", { name: /^Next: Products/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /^Products/ })).toBeFocused();
  await tabTo(page, page.getByRole("region", { name: "Add a product" }).getByRole("button", { name: /Demo Perimeter Concentrate/ }).first());
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByLabel("Total applied", { exact: true }));
  await page.keyboard.type("1.5");

  // FR-TEC-07: the review names what is missing; that error state passes axe too.
  for (const next of ["Photos", "Signature", "Payment", "Complete"]) {
    await tabTo(page, page.getByRole("button", { name: new RegExp(`^Next: ${next}`) }));
    await page.keyboard.press("Enter");
  }
  const missing = page.getByRole("alert").filter({ hasText: "Not yet: these are missing" });
  await expect(missing).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete stop" })).toBeDisabled();
  await expectAccessible(page);
  await tabTo(page, missing.getByRole("button", { name: /^Fix Demo Perimeter Concentrate/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /^Products/ })).toBeFocused();

  await tabTo(page, page.getByLabel("Area treated", { exact: true }));
  await page.keyboard.type("1800");
  await tabTo(page, page.getByRole("button", { name: "Foundation perimeter" }));
  await page.keyboard.press("Space");
  await tabTo(page, page.getByRole("button", { name: "Ants" }));
  await page.keyboard.press("Space");
  await expectAccessible(page);

  for (const next of ["Photos", "Signature", "Payment", "Complete"]) {
    await tabTo(page, page.getByRole("button", { name: new RegExp(`^Next: ${next}`) }));
    await page.keyboard.press("Enter");
    await expectAccessible(page);
  }
  await expect(missing).toHaveCount(0);
  await tabTo(page, page.getByRole("button", { name: "Complete stop" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Dez Whitlock, 1 stop, 1 done")).toBeVisible();
  // Focus lands on the page, not lost on <body>.
  expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true);
  await expectAccessible(page);
  await expect.poll(async () => (await adminQuery<{ status: string }>("select status from public.appointments where id = $1", [day.stopIds[0]]))[0]?.status, { timeout: 20_000 }).toBe("completed");
});

test("NFR-05, FR-POR-01, FR-POR-02: portal sign-in and request-service error states pass axe in dark and light", async ({ page }) => {
  const started = Date.now();
  const day = await seedDispatchDay({ date: denverToday(), techs: ["Rowan Achterberg"], stops: [{ name: "Marisol Quintero", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 }] });
  const email = `marisol-${randomUUID().slice(0, 8)}@example.com`;
  await adminQuery("update public.customers set email = $2, first_name = 'Marisol' where id = $1", [day.customerIds[0], email]);

  await page.goto(`/p/${day.tenantId}`);
  await expectAccessible(page);
  // Passes the browser's own check but not the server's.
  const field = page.getByLabel("Email");
  await field.fill("marisol@localhost");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Enter the email address you gave us.");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "dark" });

  await field.fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "is on file" })).toBeVisible();
  await page.goto(linkIn((await mailTo(email, /^Your sign-in link/, started)).text, /https?:\/\/\S+\/auth\?token=\S+/));
  await expect(page.getByRole("heading", { name: "Hi Marisol" })).toBeVisible();
  await expectAccessible(page);

  const need = page.getByLabel("What do you need?");
  await need.fill("ok");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(need).toHaveAttribute("aria-invalid", "true");
  await expect(need).toHaveAccessibleDescription("Tell us what you need");
  await expect(need).toBeFocused();
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expectAccessible(page);
});
