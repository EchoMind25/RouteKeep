import type { Locator, Page } from "@playwright/test";
import pg from "pg";
import { laneOrder, OFFICE, seedDispatchDay, type SeedStop } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// Dispatch board (FR-DSP-01..06) and pin confirmation (FR-CRM-02). Each test
// seeds its own business and day, so results do not depend on the demo data.
const DAY = "2030-03-12";
const NEXT_DAY_LABEL = "Wed, Mar 13";

/** Five stops due east of the office, seeded out of order: 1, 5, 2, 4, 3. */
function zigZag(tech = 0): SeedStop[] {
  return [1, 5, 2, 4, 3].map((k) => ({ name: `East ${["", "One", "Two", "Three", "Four", "Five"][k]}`, lat: OFFICE.lat, lng: OFFICE.lng + 0.012 * k, tech }));
}

function lane(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/**
 * Open a day and wait until the board is live. The lanes arrive as server
 * HTML before React takes over; the map renders only in the browser, so its
 * canvas means drag and drop are ready.
 */
async function openDay(page: Page, date = DAY) {
  await page.goto(`/schedule?date=${date}`);
  await page.getByRole("region", { name: "Map of the day's stops" }).locator("canvas").waitFor();
}

/**
 * Space picks up, an arrow moves, Space drops. dnd-kit starts listening for
 * arrows a moment after the pickup, so wait for its announcement first, as a
 * person would.
 */
async function keyboardMove(page: Page, handle: Locator, name: string, key: "ArrowDown" | "ArrowUp") {
  await handle.focus();
  await page.keyboard.press("Space");
  // The live region keeps only the latest message: "Picked up X." then at once "X is over <lane>."
  await expect(page.getByText(new RegExp(`^(Picked up ${name}\\.|${name} is over )`))).toBeAttached();
  await page.waitForTimeout(100);
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
}

/** dnd-kit's pointer sensor needs real movement: press, nudge past the 6 px threshold, travel, release. */
async function drag(page: Page, from: Locator, to: () => Promise<Locator>) {
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 4, { steps: 4 });
  const target = await to();
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.E2E_ADMIN_DATABASE_URL ?? `postgresql://postgres@127.0.0.1:${process.env.RK_PGPORT ?? 54329}/routeverde` });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

test("FR-DSP-01, FR-DSP-03, FR-DSP-05: lanes and map, optimize preview, save and undo", async ({ page }) => {
  const day = await seedDispatchDay({ date: DAY, techs: ["Anika Sorensen", "Ruben Okafor"], stops: [...zigZag(0), { name: "North Only", lat: OFFICE.lat + 0.02, lng: OFFICE.lng, tech: 1 }] });
  const seeded = await laneOrder(day.techIds[0]!, DAY);
  await signInAs(page, day.email);
  await openDay(page);

  const anika = lane(page, "Anika Sorensen");
  await expect(anika.getByRole("listitem")).toHaveCount(5);
  await expect(lane(page, "Ruben Okafor").getByRole("listitem")).toHaveCount(1);
  // FR-DSP-05: the stop number is the place in the route.
  await expect(anika.getByRole("button", { name: "Stop 2: show East Five on the map" })).toBeVisible();
  // FR-DSP-01: the map shares the screen and draws without errors (the fixture fails on any console error).
  await expect(page.getByRole("region", { name: "Map of the day's stops" }).locator("canvas")).toBeVisible();
  await expectAccessible(page);

  // FR-DSP-03: a preview first; nothing changes until it is saved.
  await anika.getByRole("button", { name: "Optimize Anika Sorensen's route" }).click();
  const preview = page.getByRole("dialog", { name: "Optimize Anika Sorensen" });
  await expect(preview.getByText("Driving now")).toBeVisible();
  await expect(preview.getByText(/ less$/)).toBeVisible();
  await expectAccessible(page);
  expect(await laneOrder(day.techIds[0]!, DAY)).toEqual(seeded);
  await preview.getByRole("button", { name: "Save this order" }).click();
  await expect(page.getByText(/New order saved for Anika Sorensen/)).toBeVisible();
  // East One to Five is the straight line out from the office.
  const optimized = await laneOrder(day.techIds[0]!, DAY);
  expect(optimized).toEqual([seeded[0], seeded[2], seeded[4], seeded[3], seeded[1]]);
  await expect(anika.getByRole("button", { name: "Stop 5: show East Five on the map" })).toBeVisible();

  // Undo the last commit.
  await anika.getByRole("button", { name: "Undo the last optimize for Anika Sorensen" }).click();
  await expect(page.getByText("Previous order restored.")).toBeVisible();
  expect(await laneOrder(day.techIds[0]!, DAY)).toEqual(seeded);
  await expect(anika.getByRole("button", { name: "Undo the last optimize for Anika Sorensen" })).toHaveCount(0);
});

test("FR-DSP-02: keyboard reordering persists, and a move made on a stale board is refused", async ({ page }) => {
  const day = await seedDispatchDay({ date: DAY, techs: ["Anika Sorensen"], stops: zigZag(0) });
  const seeded = await laneOrder(day.techIds[0]!, DAY);
  await signInAs(page, day.email);
  await openDay(page);
  const other = await page.context().newPage();
  await openDay(other);
  await expect(lane(other, "Anika Sorensen").getByRole("listitem")).toHaveCount(5);

  const anika = lane(page, "Anika Sorensen");
  await keyboardMove(page, anika.getByRole("button", { name: "Move East Five" }), "East Five", "ArrowDown");
  await expect(anika.getByRole("button", { name: "Stop 3: show East Five on the map" })).toBeVisible();
  await expect.poll(() => laneOrder(day.techIds[0]!, DAY)).toEqual([seeded[0], seeded[2], seeded[1], seeded[3], seeded[4]]);

  // The second tab still shows the old order; its move must not overwrite the first.
  const stale = lane(other, "Anika Sorensen");
  await keyboardMove(other, stale.getByRole("button", { name: "Move East Four" }), "East Four", "ArrowUp");
  await expect(other.getByRole("alert").filter({ hasText: "This route changed while you were working on it" })).toBeVisible();
  // It reloads to the saved order.
  await expect(stale.getByRole("button", { name: "Stop 3: show East Five on the map" })).toBeVisible();
  expect(await laneOrder(day.techIds[0]!, DAY)).toEqual([seeded[0], seeded[2], seeded[1], seeded[3], seeded[4]]);
  await other.close();
});

test("FR-DSP-04: queued work is always in view and drags onto a route; stops drag to another day", async ({ page }) => {
  const day = await seedDispatchDay({
    date: DAY,
    techs: ["Anika Sorensen"],
    stops: [
      { name: "Lane First", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 },
      { name: "Lane Second", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0 },
      { name: "Queue Undated", lat: OFFICE.lat + 0.01, lng: OFFICE.lng, tech: null, status: "unscheduled" },
      { name: "Queue Skipped", lat: OFFICE.lat - 0.01, lng: OFFICE.lng, tech: 0, status: "skipped" },
    ],
  });
  await signInAs(page, day.email);
  await openDay(page);

  const queue = page.getByRole("region", { name: "Needs attention" });
  await expect(queue.getByText("Queue Undated")).toBeVisible();
  await expect(queue.getByText("Needs a date")).toBeVisible();
  await expect(queue.getByText("Queue Skipped")).toBeVisible();
  const anika = lane(page, "Anika Sorensen");
  await expect(anika.getByRole("listitem")).toHaveCount(2);

  // Queue to route: the visit gets this day and this technician, at the drop position.
  await drag(page, queue.getByRole("button", { name: "Move Queue Undated onto a route" }), async () => anika.getByRole("listitem").nth(1));
  await expect(page.getByText("Queue Undated added to Anika Sorensen.")).toBeVisible();
  await expect(anika.getByRole("listitem")).toHaveCount(3);
  await expect(queue.getByText("Queue Undated")).toHaveCount(0);
  const [placed] = await sql<{ status: string; local_date: string; technician_id: string }>(
    "select status, local_date::text, technician_id from public.appointments where id = $1",
    [day.stopIds[2]],
  );
  expect(placed).toEqual({ status: "scheduled", local_date: DAY, technician_id: day.techIds[0] });
  expect(await laneOrder(day.techIds[0]!, DAY)).toHaveLength(3);

  // Route to another day: drop on the day bar that appears while dragging.
  await drag(page, anika.getByRole("button", { name: "Move Lane Second" }), async () => page.getByText(NEXT_DAY_LABEL, { exact: true }));
  await expect(page.getByText(`Lane Second moved to ${NEXT_DAY_LABEL}.`)).toBeVisible();
  await expect(anika.getByRole("listitem")).toHaveCount(2);
  const [moved] = await sql<{ local_date: string; technician_id: string }>("select local_date::text, technician_id from public.appointments where id = $1", [day.stopIds[1]]);
  expect(moved).toEqual({ local_date: "2030-03-13", technician_id: day.techIds[0] });
  await expectAccessible(page);
});

test("FR-DSP-06, FR-CRM-02: a long leg is flagged before publishing, and the pin is fixed and locked", async ({ page }) => {
  const near = [1, 2, 3, 4].map((k) => ({ name: `Near ${k}`, lat: OFFICE.lat + 0.004 * k, lng: OFFICE.lng + 0.004 * k, tech: 0 }));
  // Geocoded to the wrong end of the state: St. George instead of Orem.
  const wrong: SeedStop = { name: "Wrong Pin", lat: 37.1041, lng: -113.5841, tech: 0, confidence: 0.45 };
  const day = await seedDispatchDay({ date: DAY, techs: ["Anika Sorensen"], stops: [...near.slice(0, 2), wrong, ...near.slice(2)] });
  await signInAs(page, day.email);
  await openDay(page);
  const anika = lane(page, "Anika Sorensen");
  const wrongCard = anika.getByRole("listitem").filter({ hasText: "Wrong Pin" });
  await expect(wrongCard.getByText("Long drive")).toBeVisible();
  await expect(wrongCard.getByRole("link", { name: "Check pin for Wrong Pin" })).toBeVisible();

  // Publishing asks first and names the stop.
  await anika.getByRole("button", { name: "Publish Anika Sorensen's route" }).click();
  const check = page.getByRole("dialog", { name: "Check these stops before publishing" });
  await expect(check.getByText("Wrong Pin", { exact: true })).toBeVisible();
  await expectAccessible(page);
  await check.getByRole("button", { name: "Publish anyway" }).click();
  await expect(page.getByText("Route published for Anika Sorensen.")).toBeVisible();
  await expect(anika.getByText("Published", { exact: true })).toBeVisible();
  const [route] = await sql<{ flagged_stops: number; published_order: string[] }>(
    "select flagged_stops, published_order from public.routes where technician_id = $1 and local_date = $2",
    [day.techIds[0], DAY],
  );
  // One wrong pin, one warning: the stop after it is not blamed for the drive back.
  expect(route!.flagged_stops).toBe(1);
  expect(route!.published_order).toEqual(await laneOrder(day.techIds[0]!, DAY));

  // FR-CRM-02: fix the pin by typing coordinates (the keyboard path), and lock it.
  await wrongCard.getByRole("link", { name: "Check pin for Wrong Pin" }).click();
  await expect(page.getByRole("heading", { name: "Check the pin", level: 1 })).toBeVisible();
  await expect(page.getByText("Address lookup, 45% sure")).toBeVisible();
  await expect(page.getByRole("region", { name: /Map: drag the pin/ }).locator("canvas")).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Latitude").fill(String(OFFICE.lat + 0.01));
  await page.getByLabel("Longitude").fill(String(OFFICE.lng + 0.01));
  await expect(page.getByLabel("Lock this pin")).toBeChecked();
  await page.getByRole("button", { name: "Save and confirm pin" }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${DAY}&done=pin$`));
  await expect(page.getByText("Pin confirmed. Drive times now use it.")).toBeVisible();
  await expect(wrongCard.getByText("Long drive")).toHaveCount(0);
  await expect(wrongCard.getByRole("link", { name: "Check pin for Wrong Pin" })).toHaveCount(0);
  const [pin] = await sql<{ lat: number; locked: boolean; confirmed: boolean }>(
    "select extensions.st_y(location::extensions.geometry) as lat, location_locked as locked, location_confirmed_at is not null as confirmed from public.properties where id = $1",
    [day.propertyIds[2]],
  );
  expect(pin).toEqual({ lat: OFFICE.lat + 0.01, locked: true, confirmed: true });

  // R-BUG-05: a locked pin does not move until someone chooses to move it.
  await page.goto(`/customers/${day.customerIds[2]}`);
  await expect(page.getByText("Pin confirmed and locked")).toBeVisible();
  await page.getByRole("link", { name: /^Check pin/ }).click();
  await expect(page.getByText("This pin is locked: address changes and imports never move it.")).toBeVisible();
  await expect(page.getByLabel("Latitude")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Move this pin" }).click();
  await expect(page.getByLabel("Latitude")).not.toHaveAttribute("readonly", "");
});

test("FR-DSP Accept: 500 stops render in under 1.5 s", async ({ page }) => {
  // Four technicians, 125 stops each, spread over the valley.
  const stops: SeedStop[] = Array.from({ length: 500 }, (_, i) => ({
    name: `Load ${String(i + 1).padStart(3, "0")}`,
    lat: 40.15 + ((i * 37) % 100) / 250,
    lng: -111.95 + ((i * 53) % 100) / 250,
    tech: i % 4,
    durationMin: 5,
    window: i % 3 === 0 ? (["08:00", "12:00"] as [string, string]) : undefined,
  }));
  const day = await seedDispatchDay({ date: DAY, techs: ["Load One", "Load Two", "Load Three", "Load Four"], stops });
  await signInAs(page, day.email);
  // Warm the route once so the measurement is the board, not the server's first compile of the page.
  await page.goto(`/schedule?date=2030-03-11`);
  await page.locator(".maplibregl-canvas").waitFor();

  // Timed inside the page from the start of navigation: the map exists only
  // once the board has hydrated, so its canvas marks "rendered and usable".
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (document.querySelector(".maplibregl-canvas")) {
        (window as unknown as { boardReady: number }).boardReady = performance.now();
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`/schedule?date=${DAY}`);
  await page.locator(".maplibregl-canvas").waitFor();
  const ready = await page.evaluate(() => (window as unknown as { boardReady: number }).boardReady);
  expect(await page.locator('[aria-roledescription="sortable"]').count()).toBe(500);
  test.info().annotations.push({ type: "500-stop render (ms)", description: String(Math.round(ready)) });
  expect(ready).toBeLessThan(1500);
});

test("the board fits a phone screen @mobile", async ({ page }) => {
  const day = await seedDispatchDay({
    date: DAY,
    techs: ["Anika Sorensen"],
    stops: [...zigZag(0), { name: "Queue Undated", lat: OFFICE.lat + 0.01, lng: OFFICE.lng, tech: null, status: "unscheduled" }],
  });
  await signInAs(page, day.email);
  await openDay(page);
  await expect(lane(page, "Anika Sorensen").getByRole("listitem")).toHaveCount(5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // On a narrow screen the queue comes before the lanes; on a wide one it sits beside them.
  const queueTop = (await page.getByRole("region", { name: "Needs attention" }).boundingBox())!.y;
  const laneTop = (await lane(page, "Anika Sorensen").boundingBox())!.y;
  if (page.viewportSize()!.width < 1280) expect(queueTop).toBeLessThan(laneTop);
  else expect(queueTop).toBe(laneTop);
  await expectAccessible(page);
});
