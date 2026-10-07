import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, signInAs, test } from "./fixtures";

// The technician app's sync API (FR-TEC-01, NFR-01, NFR-02, ENG-01, FR-TEC-07).
// Exercised over HTTP with a real session, against a real database.

const key = (prefix: string) => `${prefix}-${randomUUID()}`;

function application(productId: string) {
  const now = new Date().toISOString();
  return {
    key: key("app"),
    productId,
    mixRate: 0.5,
    mixUnit: "fl_oz_per_gal",
    totalAmount: 1.5,
    amountUnit: "gal",
    areaTreated: 1800,
    areaUnit: "linear_ft",
    targetSites: ["Foundation perimeter"],
    targetPests: ["Ants"],
    appliedAt: now,
    capturedAt: now,
    customerStatementAt: null,
  };
}

function upload(request: APIRequestContext, mutations: unknown[], headers?: Record<string, string>) {
  return request.post("/api/tech/upload", { data: { protocol: 1, mutations }, headers });
}

async function statuses(response: Awaited<ReturnType<typeof upload>>) {
  expect(response.status()).toBe(200);
  return ((await response.json()) as { results: { status: string; message?: string }[] }).results;
}

test("FR-TEC-01, NFR-02: snapshot, idempotent upload, conflicts, refusals without partial writes", async ({ page, playwright }) => {
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Anika Sorensen", "Ruben Okafor"],
    techLogins: [0],
    products: [{ name: "Test Perimeter Concentrate" }],
    stops: [
      { name: "Stop One", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 },
      { name: "Stop Two", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0 },
      { name: "Stop Three", lat: OFFICE.lat, lng: OFFICE.lng + 0.03, tech: 0 },
      { name: "Stop Four", lat: OFFICE.lat, lng: OFFICE.lng + 0.04, tech: 0 },
      { name: "Not Mine", lat: OFFICE.lat + 0.01, lng: OFFICE.lng, tech: 1 },
    ],
  });
  const [one, two, three, four, notMine] = day.stopIds as [string, string, string, string, string];
  const product = day.productIds[0]!;
  await signInAs(page, day.techEmails[0]!);

  // Down: the technician's own stops, in route order, with what a record needs.
  const snapshot = await page.request.get("/api/tech/sync");
  expect(snapshot.status()).toBe(200);
  expect(snapshot.headers()["cache-control"]).toContain("no-store");
  const s = await snapshot.json();
  expect(s.stops.map((x: { customerName: string }) => x.customerName)).toEqual(["Stop One", "Stop Two", "Stop Three", "Stop Four"]);
  expect(s.stops.map((x: { number: number }) => x.number)).toEqual([1, 2, 3, 4]);
  expect(s.business).toMatchObject({ name: "Dispatch Test Pest", licenseNo: "UT-BUS-0001", state: "UT" });
  expect(s.technician).toMatchObject({ name: "Anika Sorensen", licenseNo: "UT-APP-1000" });
  expect(s.products.map((p: { name: string }) => p.name)).toContain("Test Perimeter Concentrate");

  // Up: arrive and complete, then the same batch again (a retry after a lost answer).
  const at = new Date().toISOString();
  const batch = [
    { kind: "arrive", key: key("arrive"), appointmentId: one, date: today, at },
    {
      kind: "complete",
      key: key("complete"),
      appointmentId: one,
      date: today,
      at,
      applications: [application(product)],
      checklist: [{ label: "Inspected the perimeter", done: true }],
      notes: "Webs under the eaves",
      payment: { method: "cash", key: key("pay"), amountCents: 6900 },
    },
  ];
  expect((await statuses(await upload(page.request, batch))).map((r) => r.status)).toEqual(["applied", "applied"]);
  expect((await statuses(await upload(page.request, batch))).map((r) => r.status)).toEqual(["duplicate", "duplicate"]);

  const [visit] = await adminQuery<{ status: string; tech_notes: string; arrived: boolean }>(
    "select status, tech_notes, arrived_at is not null as arrived from public.appointments where id = $1",
    [one],
  );
  expect(visit).toEqual({ status: "completed", tech_notes: "Webs under the eaves", arrived: true });
  // CR-01: the record carries the business, applicator and product details from the server, once.
  const records = await adminQuery<{ business_license_no: string; applicator_license_no: string; epa_reg_no: string; customer_name: string }>(
    "select business_license_no, applicator_license_no, epa_reg_no, customer_name from public.applications where appointment_id = $1",
    [one],
  );
  expect(records).toEqual([{ business_license_no: "UT-BUS-0001", applicator_license_no: "UT-APP-1000", epa_reg_no: "0-200", customer_name: "Stop One" }]);
  const [paid] = await adminQuery<{ n: number }>("select count(*)::int as n from public.payments where customer_id = $1 and method = 'cash'", [day.customerIds[0]]);
  expect(paid!.n).toBe(1);

  // A refused stop leaves nothing behind: two records, one with an unknown product.
  const refused = await statuses(
    await upload(page.request, [
      {
        kind: "complete",
        key: key("complete"),
        appointmentId: two,
        date: today,
        at,
        applications: [application(product), application(randomUUID())],
        checklist: [],
        notes: null,
        payment: { method: "invoice_later" },
      },
    ]),
  );
  expect(refused[0]).toMatchObject({ status: "rejected", message: expect.stringContaining("no longer in the catalog") });
  const [left] = await adminQuery<{ n: number; status: string }>(
    "select (select count(*)::int from public.applications where appointment_id = $1) as n, status from public.appointments where id = $1",
    [two],
  );
  expect(left).toEqual({ n: 0, status: "scheduled" });

  // NFR-02: the office cancelled a visit the technician then completed offline.
  // The record is kept (it happened), the visit stays cancelled, and the office gets a review item.
  await adminQuery("update public.appointments set status = 'cancelled', cancel_reason = 'Customer called' where id = $1", [three]);
  const clash = await statuses(
    await upload(page.request, [
      { kind: "complete", key: key("complete"), appointmentId: three, date: today, at, applications: [application(product)], checklist: [], notes: null, payment: { method: "invoice_later" } },
    ]),
  );
  expect(clash[0]!.status).toBe("conflict");
  const [kept] = await adminQuery<{ status: string; records: number; reviews: number }>(
    `select a.status,
            (select count(*)::int from public.applications where appointment_id = a.id) as records,
            (select count(*)::int from public.sync_conflicts where appointment_id = a.id and kind = 'completed_after_change') as reviews
     from public.appointments a where a.id = $1`,
    [three],
  );
  expect(kept).toEqual({ status: "cancelled", records: 1, reviews: 1 });

  // A visit moved to another day, and someone else's visit, are not this device's to change.
  await adminQuery("update public.appointments set local_date = local_date + 1 where id = $1", [two]);
  const moved = await statuses(await upload(page.request, [{ kind: "arrive", key: key("arrive"), appointmentId: two, date: today, at }]));
  expect(moved[0]).toMatchObject({ status: "conflict", message: "The office moved this visit to another day." });
  const others = await statuses(await upload(page.request, [{ kind: "arrive", key: key("arrive"), appointmentId: notMine, date: today, at }]));
  expect(others[0]).toMatchObject({ status: "conflict", message: "The office gave this visit to someone else." });

  // Skip, then the retry.
  const skipBatch = [{ kind: "skip", key: key("skip"), appointmentId: four, date: today, at, reason: "Gate locked, nobody home" }];
  expect((await statuses(await upload(page.request, skipBatch)))[0]!.status).toBe("applied");
  expect((await statuses(await upload(page.request, skipBatch)))[0]!.status).toBe("duplicate");

  // Malformed batches are refused whole; other sites and strangers are refused outright.
  expect((await upload(page.request, [{ kind: "arrive", key: "x", appointmentId: one, date: today, at }])).status()).toBe(400);
  expect((await upload(page.request, skipBatch, { Origin: "https://example.com" })).status()).toBe(403);
  const stranger = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await stranger.get("/api/tech/sync")).status()).toBe(401);
  await stranger.dispose();
});

test("FR-TEC-01: a login without a technician profile gets a clear answer", async ({ page }) => {
  const day = await seedDispatchDay({ date: denverToday(), techs: ["Anika Sorensen"], stops: [] });
  await signInAs(page, day.email);
  const response = await page.request.get("/api/tech/sync");
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain("not linked to a technician");
});
