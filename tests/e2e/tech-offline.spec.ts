import type { BrowserContext, Page } from "@playwright/test";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, test } from "./fixtures";

// M3 exit test (PRD section 14, FR-TEC-01..09, NFR-01, R-BUG-01): a technician
// completes a 15-stop route with no connection at all, the app is killed twice
// in the middle of a stop, the phone reconnects, and the server ends up with
// exactly 15 completed stops, each with its record, and no duplicates.

const STOPS = 15;
// A small PNG (8x8, solid) standing in for a photo.
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNocFDAihiGlgQA+gM4Acru2/oAAAAASUVORK5CYII=", "base64");
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** Same rules as the shared fixture, per page, except that the network being down is expected here. */
function watch(page: Page, problems: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`exception: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500 || r.status() === 404) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
}

async function openApp(context: BrowserContext, problems: string[]) {
  const page = await context.newPage();
  watch(page, problems);
  const response = await page.goto("/tech");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return { page, response };
}

const name = (i: number) => `Customer ${String(i).padStart(2, "0")}`;

async function startStop(page: Page, i: number) {
  await page.getByRole("button", { name: new RegExp(`Stop ${i}: ${name(i)}`) }).click();
  await page.getByRole("button", { name: /^(Arrive and start|Continue)$/ }).click();
}

async function fillProduct(page: Page, part: "all" | "first-half" | "second-half") {
  if (part !== "second-half") {
    await page.getByRole("button", { name: /^Next: Products/ }).click();
    await page.getByRole("region", { name: "Add a product" }).getByRole("button", { name: /Demo Perimeter Concentrate/ }).first().click();
    await page.getByLabel("Total applied", { exact: true }).fill("1.5");
  }
  if (part === "first-half") return;
  await page.getByLabel("Area treated", { exact: true }).fill("1800");
  await page.getByRole("button", { name: "Foundation perimeter" }).click();
  await page.getByRole("button", { name: "Ants" }).click();
}

async function finishStop(page: Page) {
  for (const next of ["Photos", "Signature", "Payment", "Complete"]) {
    await page.getByRole("button", { name: new RegExp(`^Next: ${next}`) }).click();
  }
  await page.getByRole("button", { name: "Complete stop" }).click();
  await expect(page.getByRole("list", { name: "Stops" })).toBeVisible();
}

test("M3 exit: 15 stops fully offline, the app killed twice mid-stop, then one clean upload", async ({ browser }) => {
  test.setTimeout(300_000);
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Dez Whitlock"],
    techLogins: [0],
    products: [{ name: "Demo Perimeter Concentrate" }],
    stops: Array.from({ length: STOPS }, (_, k) => ({ name: name(k + 1), lat: OFFICE.lat + 0.004 * (k + 1), lng: OFFICE.lng, tech: 0 })),
  });

  const problems: string[] = [];
  const context = await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL });
  const signIn = await context.newPage();
  watch(signIn, problems);
  await signIn.goto("/sign-in");
  await signIn.getByLabel("Work email").fill(day.techEmails[0]!);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await signIn.waitForURL(/\/tech/);

  // Online once: the route downloads and the app saves itself for offline use.
  let page = signIn;
  await expect(page.getByText(`Dez Whitlock, ${STOPS} stops, 0 done`)).toBeVisible();
  await expect(page.getByText(/^Up to date/)).toBeVisible();
  // The worker saves the page and its files as it installs; wait until it is active and has.
  // (Not serviceWorker.ready: this page began at /sign-in, outside the worker's /tech scope.)
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration("/tech");
          const keys = await caches.keys();
          return registration?.active?.state === "activated" && keys.some((k) => k.startsWith("rk-shell-")) && keys.some((k) => k.startsWith("rk-static-"));
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  // A cold start with no network comes from the phone, not the server.
  await page.close();
  ({ page } = await openApp(context, problems));
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();

  for (let i = 1; i <= STOPS; i++) {
    await startStop(page, i);
    if (i === 4) {
      // Killed in the middle of typing a product: the tab is closed outright.
      await fillProduct(page, "first-half");
      await page.waitForTimeout(600); // FR-TEC-04: every edit is on the device within 500 ms
      await page.close();
      ({ page } = await openApp(context, problems));
      await startStop(page, i);
      await expect(page.getByLabel("Total applied", { exact: true })).toHaveValue("1.5");
      await fillProduct(page, "second-half");
    } else if (i === 9) {
      // Killed again, on the payment step this time.
      await fillProduct(page, "all");
      for (const next of ["Photos", "Signature", "Payment"]) await page.getByRole("button", { name: new RegExp(`^Next: ${next}`) }).click();
      await page.getByRole("radio", { name: /Cash/ }).check();
      await page.getByLabel("Amount collected").fill("69");
      await page.waitForTimeout(600);
      await page.close();
      ({ page } = await openApp(context, problems));
      await startStop(page, i);
      // Back where it stopped, with the payment as typed.
      await expect(page.getByRole("radio", { name: /Cash/ })).toBeChecked();
      await expect(page.getByLabel("Amount collected")).toHaveValue("69");
      await page.getByRole("button", { name: /^Next: Complete/ }).click();
      await page.getByRole("button", { name: "Complete stop" }).click();
      await expect(page.getByRole("list", { name: "Stops" })).toBeVisible();
      continue;
    } else {
      await fillProduct(page, "all");
      if (i === 2) {
        // FR-TEC-09: a photo taken offline waits on the phone and uploads later.
        await page.getByRole("button", { name: /^Next: Photos/ }).click();
        await page.locator("#photo-input").setInputFiles({ name: "gate.png", mimeType: "image/png", buffer: PHOTO });
        await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
        await page.getByRole("button", { name: /^Next: Signature/ }).click();
        for (const next of ["Payment", "Complete"]) await page.getByRole("button", { name: new RegExp(`^Next: ${next}`) }).click();
        await page.getByRole("button", { name: "Complete stop" }).click();
        await expect(page.getByRole("list", { name: "Stops" })).toBeVisible();
        continue;
      }
    }
    await finishStop(page);
  }

  await expect(page.getByText(`Dez Whitlock, ${STOPS} stops, ${STOPS} done`)).toBeVisible();
  // FR-TEC-05: offline, and every arrival, completion and the photo waiting to upload.
  await expect(page.getByText(`Offline, ${STOPS * 2 + 1} waiting to upload`)).toBeVisible();
  const [before] = await adminQuery<{ done: number; records: number }>(
    `select (select count(*)::int from public.appointments where tenant_id = $1 and status = 'completed') as done,
            (select count(*)::int from public.applications where tenant_id = $1) as records`,
    [day.tenantId],
  );
  expect(before).toEqual({ done: 0, records: 0 });

  await context.setOffline(false);
  await expect(page.getByText(/^Up to date/)).toBeVisible({ timeout: 30_000 });

  const [after] = await adminQuery<{ done: number; records: number; keys: number; per_stop: number; arrived: number; cash: number }>(
    `select (select count(*)::int from public.appointments where tenant_id = $1 and status = 'completed') as done,
            (select count(*)::int from public.applications where tenant_id = $1) as records,
            (select count(distinct client_key)::int from public.applications where tenant_id = $1) as keys,
            (select max(n)::int from (select count(*) as n from public.applications where tenant_id = $1 group by appointment_id) x) as per_stop,
            (select count(*)::int from public.appointments where tenant_id = $1 and arrived_at is not null and completed_at is not null) as arrived,
            (select count(*)::int from public.payments where tenant_id = $1 and method = 'cash' and amount_cents = 6900) as cash`,
    [day.tenantId],
  );
  expect(after).toEqual({ done: STOPS, records: STOPS, keys: STOPS, per_stop: 1, arrived: STOPS, cash: 1 });
  const photos = await adminQuery<{ owner_id: string; kind: string }>("select owner_id, kind from public.attachments where tenant_id = $1", [day.tenantId]);
  expect(photos).toEqual([{ owner_id: day.stopIds[1], kind: "photo" }]);

  // A second sync changes nothing: every key has been used once.
  await page.getByRole("button", { name: /All saved on this phone/ }).click();
  await expect(page.getByText(/^Up to date/)).toBeVisible();
  const [again] = await adminQuery<{ records: number }>("select count(*)::int as records from public.applications where tenant_id = $1", [day.tenantId]);
  expect(again!.records).toBe(STOPS);

  expect(problems).toEqual([]);
  await context.close();
});
