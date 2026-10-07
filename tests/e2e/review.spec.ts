import { randomUUID } from "node:crypto";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// NFR-02: field work recorded on a phone after the office changed the visit
// is kept, and waits for a person to decide what the visit should say.

test("NFR-02: the office reviews clashes: one marked done as recorded, one kept as the office had it", async ({ page, browser }) => {
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Anika Sorensen"],
    techLogins: [0],
    products: [{ name: "Test Perimeter Concentrate" }],
    stops: [
      { name: "Cancelled Then Done", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 },
      { name: "Moved Then Done", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0 },
    ],
  });
  const [cancelled, moved] = day.stopIds as [string, string];

  // The office changes both visits while the technician is offline...
  await adminQuery("update public.appointments set status = 'cancelled', cancel_reason = 'Customer called' where id = $1", [cancelled]);
  await adminQuery("update public.appointments set local_date = local_date + 2 where id = $1", [moved]);

  // ...and the phone, which never heard, uploads both as done.
  const techContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tech = await techContext.newPage();
  await signInAs(tech, day.techEmails[0]!);
  const at = new Date().toISOString();
  const complete = (appointmentId: string) => ({
    kind: "complete",
    key: `complete-${randomUUID()}`,
    appointmentId,
    date: today,
    at,
    applications: [
      {
        key: `app-${randomUUID()}`,
        productId: day.productIds[0],
        mixRate: 0.5,
        mixUnit: "fl_oz_per_gal",
        totalAmount: 1,
        amountUnit: "gal",
        areaTreated: 900,
        areaUnit: "linear_ft",
        targetSites: ["Foundation perimeter"],
        targetPests: ["Ants"],
        appliedAt: at,
        capturedAt: at,
        customerStatementAt: null,
      },
    ],
    checklist: [],
    notes: null,
    payment: { method: "invoice_later" },
  });
  const sent = await tech.request.post("/api/tech/upload", { data: { protocol: 1, mutations: [complete(cancelled), complete(moved)] } });
  expect(((await sent.json()) as { results: { status: string }[] }).results.map((r) => r.status)).toEqual(["conflict", "conflict"]);
  await techContext.close();

  // The office sees it from the board.
  await signInAs(page, day.email);
  await page.goto(`/schedule?date=${today}`);
  await page.getByRole("link", { name: "2 field visits to review" }).click();
  await expect(page).toHaveURL(/\/schedule\/review$/);
  const first = page.getByRole("region", { name: /^Cancelled Then Done/ });
  const second = page.getByRole("region", { name: /^Moved Then Done/ });
  await expect(first.getByText(/Anika Sorensen completed this visit on .*, but the office had cancelled it \(Customer called\)\./)).toBeVisible();
  await expect(second.getByText(/Anika Sorensen completed this visit on .*, but the office had moved it to /)).toBeVisible();
  await expect(first.getByText("1 product record saved.")).toBeVisible();
  await expectAccessible(page);

  await first.getByRole("button", { name: "Mark it done" }).click();
  await expect(page.getByText("The visit now says what happened in the field.")).toBeVisible();
  await page.getByRole("region", { name: /^Moved Then Done/ }).getByRole("button", { name: "Keep the office's version" }).click();
  await expect(page.getByText("The office's version stands. The field records stay on the visit.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing to review" })).toBeVisible();

  const visits = await adminQuery<{ id: string; status: string; local_date: string; technician_id: string; completed: boolean }>(
    "select id, status, local_date::text, technician_id, completed_at is not null as completed from public.appointments where id = any($1::uuid[]) order by id = $2 desc",
    [[cancelled, moved], cancelled],
  );
  expect(visits[0]).toMatchObject({ id: cancelled, status: "completed", local_date: today, technician_id: day.techIds[0], completed: true });
  expect(visits[1]).toMatchObject({ id: moved, status: "scheduled", completed: false });
  expect(visits[1]!.local_date).not.toBe(today);
  const reviews = await adminQuery<{ resolution: string; by_owner: boolean }>(
    `select resolution, resolved_by = (select user_id from public.memberships where tenant_id = $1 and role = 'owner') as by_owner
     from public.sync_conflicts where tenant_id = $1 order by resolution`,
    [day.tenantId],
  );
  expect(reviews).toEqual([
    { resolution: "Kept the office's version", by_owner: true },
    { resolution: "Marked done as recorded in the field", by_owner: true },
  ]);
  // The records were kept either way.
  const [kept] = await adminQuery<{ n: number }>("select count(*)::int as n from public.applications where appointment_id = any($1::uuid[])", [[cancelled, moved]]);
  expect(kept!.n).toBe(2);
});
