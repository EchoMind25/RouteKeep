import { randomUUID } from "node:crypto";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import { pdfText } from "./pdf";

// FR-REC-03: records are never edited after the fact. A correction is a new
// version linked to the one it corrects, with a reason, audited (CR-12); the
// earlier version stays on file, and everything downstream (the PDF, the
// phone's prefill) uses the current one.

test("FR-REC-03: amend a record; history kept, audited, a stale amendment refused", async ({ page, browser }) => {
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Anika Sorensen"],
    techLogins: [0],
    products: [
      { name: "Amend Test Perimeter", epaRegNo: "279-3206" },
      { name: "Amend Test Fumigant", epaRegNo: "5481-541", signalWord: "danger", restrictedUse: true },
    ],
    stops: [{ name: "Amended Household", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 }],
  });
  const [stop] = day.stopIds as [string];

  // The technician records 1.5 gal from the phone.
  const phone = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  const at = new Date().toISOString();
  const sent = await tech.request.post("/api/tech/upload", {
    data: {
      protocol: 1,
      mutations: [
        {
          kind: "complete", key: `complete-${randomUUID()}`, appointmentId: stop, date: today, at,
          applications: [{
            key: `app-${randomUUID()}`, productId: day.productIds[0], mixRate: 0.5, mixUnit: "fl_oz_per_gal", totalAmount: 1.5, amountUnit: "gal",
            areaTreated: 900, areaUnit: "linear_ft", targetSites: ["Foundation perimeter"], targetPests: ["Ants"], appliedAt: at, capturedAt: at, customerStatementAt: null,
          }],
          checklist: [], notes: null, payment: { method: "invoice_later" },
        },
      ],
    },
  });
  expect(((await sent.json()) as { results: { status: string }[] }).results[0]!.status).toBe("applied");

  await signInAs(page, day.email);
  await page.goto(`/schedule/visits/${stop}`);
  const card = page.getByRole("region", { name: "Amend Test Perimeter" });
  await card.getByRole("link", { name: "Amend the Amend Test Perimeter record" }).click();
  await expect(page.getByRole("heading", { name: "Amend Amend Test Perimeter", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Total applied", { exact: true })).toHaveValue("1.5");
  await expect(page.getByLabel("Total applied unit")).toHaveValue("gal");
  await expect(page.getByLabel("Target pests")).toHaveValue("Ants");
  await expectAccessible(page);
  const amendUrl = page.url();

  // A second person opens the same version at the same time.
  const second = await page.context().newPage();
  await second.goto(amendUrl);

  // A reason is required.
  await page.getByLabel("Total applied", { exact: true }).fill("1.25");
  await page.getByRole("button", { name: "Save amendment" }).click();
  await expect(page.getByText("The reason is required")).toBeVisible();
  await page.getByLabel("Reason for the amendment").fill("Total was keyed from the wrong tank");
  await page.getByRole("button", { name: "Save amendment" }).click();
  await expect(page.getByText("Amendment saved. The record shows the corrected version; the earlier one stays on file.")).toBeVisible();
  await expect(card.getByText("1.25 gal")).toBeVisible();
  await expect(card.getByText("Amended", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Amended .*: Total was keyed from the wrong tank$/)).toBeVisible();
  await card.getByText("Earlier version").click();
  await expect(card.getByText(/^Original, recorded /)).toBeVisible();
  await expect(card.getByText("1.5 gal")).toBeVisible();
  await expectAccessible(page);

  // The second person's amendment is refused: it would fork the record.
  await second.getByLabel("Total applied", { exact: true }).fill("2");
  await second.getByLabel("Reason for the amendment").fill("Also wrong");
  await second.getByRole("button", { name: "Save amendment" }).click();
  await expect(second.getByText(/Someone amended this record while you were editing/)).toBeVisible();
  // And the old version cannot be amended again from its own page.
  await second.goto(amendUrl);
  await expect(second.getByText("This version has been amended since. Open the visit and amend the latest version.")).toBeVisible();
  await second.close();

  // A restricted-use Danger product needs the customer's statement time.
  await card.getByRole("link", { name: /^Amend the/ }).click();
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Amend Test Fumigant, EPA 5481-541" });
  await page.getByLabel("Reason for the amendment").fill("Wrong product picked on the phone");
  await page.getByRole("button", { name: "Save amendment" }).click();
  await expect(page.getByText("This product needs the customer's written statement before application. Enter when it was given.").first()).toBeVisible();
  await page.getByLabel("Given on").fill(today);
  await page.getByLabel("Given at").fill("08:00");
  await page.getByRole("button", { name: "Save amendment" }).click();
  await expect(page.getByText(/^Amendment saved/)).toBeVisible();
  const fumigant = page.getByRole("region", { name: "Amend Test Fumigant" });
  await expect(fumigant.getByText("Restricted use")).toBeVisible();
  await expect(fumigant.getByText("2 earlier versions")).toBeVisible();

  // On file: three versions in one chain, each insert audited with who made it.
  const versions = await adminQuery<{ id: string; amended_from: string | null; total: string; reason: string | null; product: string }>(
    `with recursive chain as (
       select a.*, 0 as depth from public.applications a where a.appointment_id = $1 and a.amended_from is null
       union all select b.*, chain.depth + 1 from public.applications b join chain on b.amended_from = chain.id)
     select id, amended_from, total_amount::text as total, amendment_reason as reason, product_name as product from chain order by depth`,
    [stop],
  );
  expect(versions.map((v) => [Number(v.total), v.reason, v.product])).toEqual([
    [1.5, null, "Amend Test Perimeter"],
    [1.25, "Total was keyed from the wrong tank", "Amend Test Perimeter"],
    [1.25, "Wrong product picked on the phone", "Amend Test Fumigant"],
  ]);
  expect(versions[1]!.amended_from).toBe(versions[0]!.id);
  expect(versions[2]!.amended_from).toBe(versions[1]!.id);
  const audit = await adminQuery<{ by_owner: boolean }>(
    `select actor_id = (select user_id from public.memberships where tenant_id = $1 and role = 'owner') as by_owner
     from public.audit_log where table_name = 'applications' and action = 'insert' and row_id = any($2::uuid[]) order by at`,
    [day.tenantId, [versions[1]!.id, versions[2]!.id]],
  );
  expect(audit).toEqual([{ by_owner: true }, { by_owner: true }]);

  // The customer's PDF shows the current version and says it was amended.
  const pdf = pdfText(await (await page.request.get(`/api/records/${stop}`)).body());
  expect(pdf).toContain("Amend Test Fumigant");
  expect(pdf).toContain("Amended");
  expect(pdf).not.toContain("Amend Test Perimeter");

  // The phone's prefill for this property uses the corrected record.
  const snapshot = (await (await tech.request.get("/api/tech/sync")).json()) as { stops: { id: string; propertyId: string }[]; lastMixes: Record<string, { productId: string; totalAmount: number }[]> };
  const property = snapshot.stops.find((s) => s.id === stop)!.propertyId;
  expect(snapshot.lastMixes[property]).toEqual([expect.objectContaining({ productId: day.productIds[1], totalAmount: 1.25 })]);
  await phone.close();
});
