import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// CR-02: a record is due within 24 hours of the application. The phone warns
// from 20 hours and says when one is late; the office is told the same, since
// a finished record can sit on a phone with no signal.

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DUE = /^Record due by (\w{3} )?\d{1,2}:\d{2} [AP]M$/;

test("CR-02: started visits warn at 20 hours and show overdue at 24, on the phone and in the office", async ({ page, browser }) => {
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Rowan Achterberg"],
    techLogins: [0],
    products: [{ name: "Test Perimeter Concentrate" }],
    stops: [
      { name: "Due Soon Household", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 },
      { name: "Overdue Household", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0 },
      { name: "Fresh Household", lat: OFFICE.lat, lng: OFFICE.lng + 0.03, tech: 0 },
    ],
  });
  const [dueSoon, overdue] = day.stopIds as [string, string, string];
  // Started on a phone 21 and 25 hours ago, and nothing since.
  await adminQuery("update public.appointments set status = 'in_progress', arrived_at = now() - interval '21 hours' where id = $1", [dueSoon]);
  await adminQuery("update public.appointments set status = 'in_progress', arrived_at = now() - interval '25 hours' where id = $1", [overdue]);

  // The office sees both on the schedule, the late one first.
  await signInAs(page, day.email);
  await page.goto(`/schedule?date=${today}`);
  const banner = page.getByRole("alert").filter({ hasText: "2 started visits have no record yet" });
  await expect(banner.getByRole("listitem")).toHaveText([
    /^Overdue Household, Rowan Achterberg: overdue since /,
    /^Due Soon Household, Rowan Achterberg: due by /,
  ]);
  await banner.getByRole("link", { name: "Due Soon Household" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Record due by .*Nothing has reached the office for this visit yet\.$/ })).toBeVisible();
  await expectAccessible(page);

  // The phone says the same on the day list and on the stop.
  const phone = await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  const stops = tech.getByRole("list", { name: "Stops" });
  const card = (name: string) => stops.getByRole("button", { name: new RegExp(name) });
  await expect(card("Overdue Household").getByText("Record overdue", { exact: true })).toBeVisible();
  await expect(card("Due Soon Household").getByText(DUE)).toBeVisible();
  await expect(card("Fresh Household").getByText(/^Record /)).toHaveCount(0);
  await expectAccessible(tech);

  await card("Overdue Household").click();
  await expect(tech.getByRole("alert").filter({ hasText: /^Record overdue since / })).toBeVisible();
  // Already started as far as the office knows, so the phone carries on from that arrival.
  await tech.getByRole("button", { name: "Continue" }).click();
  // Still late inside the flow: the 24 hours count from the first arrival.
  await expect(tech.getByRole("alert").filter({ hasText: /^Record overdue since / })).toBeVisible();
  await tech.getByRole("button", { name: /^Next: Products/ }).click();
  await tech.getByRole("region", { name: "Add a product" }).getByRole("button", { name: /Test Perimeter Concentrate/ }).first().click();
  await tech.getByLabel("Total applied", { exact: true }).fill("1");
  await tech.getByLabel("Area treated", { exact: true }).fill("900");
  await tech.getByRole("button", { name: "Foundation perimeter" }).click();
  await tech.getByRole("button", { name: "Ants" }).click();
  for (const next of ["Photos", "Signature", "Payment", "Complete"]) await tech.getByRole("button", { name: new RegExp(`^Next: ${next}`) }).click();
  await tech.getByRole("button", { name: "Complete stop" }).click();
  await expect(card("Overdue Household").getByText(/^Done/)).toBeVisible();
  await expect(card("Overdue Household").getByText(/^Record /)).toHaveCount(0);
  await expect(tech.getByText(/^Up to date/)).toBeVisible({ timeout: 15_000 });

  // Once the record arrives the office stops warning about it, and the record says when it was made.
  await page.goto(`/schedule?date=${today}`);
  await expect(page.getByRole("status").filter({ hasText: "1 started visit has no record yet" }).getByRole("listitem")).toHaveText([/^Due Soon Household/]);
  await page.goto(`/schedule/visits/${overdue}`);
  await expect(page.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M \(on time\)$/)).toBeVisible();
  // The phone sent no second arrival: the office keeps the first.
  const [visit] = await adminQuery<{ hours: number }>("select round(extract(epoch from now() - arrived_at) / 3600)::int as hours from public.appointments where id = $1", [overdue]);
  expect(visit!.hours).toBe(25);

  // A stop from an earlier day can still be opened when today has none. The
  // phone is cut off from new routes, and its copy is rolled back a day.
  await phone.route("**/api/tech/sync", (route) => route.abort());
  const yesterday = await adminQuery<{ d: string }>("select ($1::date - 1)::text as d", [today]).then((r) => r[0]!.d);
  await tech.evaluate(async (date) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("routeverde-tech");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction("stops", "readwrite");
    const store = tx.objectStore("stops");
    const all = await new Promise<{ date: string }[]>((resolve) => {
      const read = store.getAll();
      read.onsuccess = () => resolve(read.result);
    });
    for (const stop of all) store.put({ ...stop, date });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, yesterday);
  await tech.reload();
  await expect(tech.getByRole("heading", { name: "No stops today" })).toBeVisible();
  const earlier = tech.getByRole("list", { name: "From an earlier day" });
  await expect(earlier.getByRole("listitem")).toHaveCount(3);
  await earlier.getByRole("button", { name: /Due Soon Household/ }).click();
  await expect(tech.getByRole("status").filter({ hasText: /^Record due by / })).toBeVisible();
  await phone.close();
});
