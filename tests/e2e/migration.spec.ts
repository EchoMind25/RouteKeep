import { strFromU8, unzipSync } from "fflate";
import { adminQuery, denverToday, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// M5, PRD section 9 and 8.10: import a customer list from another system's
// export, check it, import it, see the totals, re-import without duplicates,
// export everything, start a fresh business from that export (FR-EXP-03),
// and undo the import (FR-MIG-14).

const NEXT = new Date(Date.parse(`${denverToday()}T12:00:00Z`) + 14 * 86_400_000);
const NEXT_ISO = NEXT.toISOString().slice(0, 10);
const NEXT_US = `${NEXT.getUTCMonth() + 1}/${NEXT.getUTCDate()}/${NEXT.getUTCFullYear()}`;

const CSV = [
  "Cust #,Name,Street,City,State,Zip,Email,Phone #,Plan,Next Service,Balance Due",
  `1001,"Quintero, Marisol",1450 S Sandhill Rd,Orem,Utah,84058,marisol@example.com,(801) 555-0142,Quarterly Pest,${NEXT_US},$45.50`,
  "1002,Bo Lin,22 E Center St,Provo,UT,84606,,801-555-0199,,,",
  "1003,Arches Dental,500 N State St,Orem,UT,84057,office@archesdental.example,8015550123,,,(10.00)",
  "1004,No Zip Person,9 W 100 N,Lehi,UT,,,,,,",
  "1001,\"Quintero, Marisol\",1450 S Sandhill Rd,Orem,UT,84058,,,,,",
].join("\r\n");

async function newBusiness() {
  const day = await seedDispatchDay({ date: denverToday(), techs: [], stops: [] });
  await adminQuery(
    `insert into public.service_plans (tenant_id, service_type_id, name, price_cents, rrule, billing_mode)
     select $1, id, 'Quarterly Pest', 12900, 'FREQ=MONTHLY;INTERVAL=3', 'per_service' from public.service_types where tenant_id = $1 limit 1`,
    [day.tenantId],
  );
  return day;
}

const stat = (page: import("@playwright/test").Page, label: string) => page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

test("M5: import, check, commit, reconcile, re-import, export, start over from the export, undo", async ({ page }) => {
  test.setTimeout(120_000);
  const day = await newBusiness();
  await signInAs(page, day.email);

  // Upload: the columns are matched by name and by what the values look like.
  await page.goto("/settings/import");
  await expectAccessible(page);
  await page.getByLabel("Customer list (CSV)").setInputFiles({ name: "old-software.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.getByRole("button", { name: "Upload and match columns" }).click();
  await expect(page.getByRole("heading", { name: "old-software.csv" })).toBeVisible();
  await expect(page.getByLabel("Customer number or ID")).toHaveValue("Cust #");
  await expect(page.getByLabel("ZIP code")).toHaveValue("Zip");
  await expect(page.getByLabel(/^Phone/)).toHaveValue("Phone #");
  await expectAccessible(page);

  // Check: nothing is added yet; every row is sorted with its reasons.
  await page.getByRole("button", { name: "Check every row" }).click();
  await expect(page.getByText("Every row checked.")).toBeVisible();
  await expect(stat(page, "New customers")).toHaveText("3");
  await expect(stat(page, "Need fixing")).toHaveText("1");
  await expect(stat(page, "Duplicates skipped")).toHaveText("1");
  await expect(stat(page, "Active plans")).toHaveText("1");
  await expect(stat(page, "Monthly plan revenue")).toHaveText("$43.00");
  await expect(stat(page, "Open balances")).toHaveText("$45.50");
  await expect(page.getByRole("region", { name: "Rows that will not be imported" })).toContainText("No ZIP code");
  const fix = await page.request.get(await page.getByRole("link", { name: /Download the rows to fix/ }).getAttribute("href").then((h) => h!));
  expect(await fix.text()).toContain("No Zip Person,9 W 100 N,Lehi,UT,,,,,,,No ZIP code");
  expect(await adminQuery("select 1 from public.customers where tenant_id = $1", [day.tenantId])).toHaveLength(0);
  await expectAccessible(page);

  // Import, then the totals side by side.
  await page.getByRole("button", { name: "Import 3 customers" }).click();
  await expect(page.getByText("Everything in the file is here.")).toBeVisible();
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals.getByRole("row").filter({ hasText: "Customers" })).toContainText("33");
  await expect(totals.getByRole("row").filter({ hasText: "Opening balances" })).toContainText("$35.50$35.50");
  const [counts] = await adminQuery<{ customers: number; subs: number; visits: number; balance: number }>(
    `select (select count(*)::int from public.customers where tenant_id = $1) as customers,
            (select count(*)::int from public.subscriptions where tenant_id = $1) as subs,
            (select count(*)::int from public.appointments where tenant_id = $1) as visits,
            (select coalesce(sum(amount_cents), 0)::int from public.ledger_entries where tenant_id = $1 and type = 'opening_balance') as balance`,
    [day.tenantId],
  );
  expect(counts!.customers).toBe(3);
  expect(counts!.subs).toBe(1);
  expect(counts!.visits).toBeGreaterThan(0);
  expect(counts!.balance).toBe(3550);
  const [marisol] = await adminQuery<{ phone: string; first_name: string; start: string }>(
    "select c.phone, c.first_name, s.start_date::text as start from public.customers c join public.subscriptions s on s.customer_id = c.id where c.tenant_id = $1",
    [day.tenantId],
  );
  expect(marisol).toEqual({ phone: "+18015550142", first_name: "Marisol", start: NEXT_ISO });

  // The same file again changes nothing (FR-MIG-12).
  await page.goto("/settings/import");
  await page.getByLabel("Customer list (CSV)").setInputFiles({ name: "old-software.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.getByRole("button", { name: "Upload and match columns" }).click();
  await page.getByRole("button", { name: "Check every row" }).click();
  await expect(stat(page, "New customers")).toHaveText("0");
  await expect(stat(page, "Already here, unchanged")).toHaveText("3");
  await expect(page.getByRole("button", { name: /^Import \d/ })).toHaveCount(0);

  // Export everything (FR-EXP-01), and read the file.
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Export" }).click();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Export everything" }).click();
  const download = page.getByRole("link", { name: "Download" }).first();
  await expect(download).toBeVisible({ timeout: 60_000 });
  const zip = unzipSync(new Uint8Array(await (await page.request.get((await download.getAttribute("href"))!)).body()));
  const names = Object.keys(zip);
  for (const f of ["manifest.json", "README.txt", "customers-import.csv", "tables/customers.csv", "tables/customers.json", "tables/properties.csv", "tables/ledger_entries.csv"]) expect(names).toContain(f);
  expect(strFromU8(zip["tables/properties.csv"]!)).toContain("location_lat");
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]!)) as { formatVersion: string; unreadableTables: unknown[] };
  expect(manifest.formatVersion).toBe("1");
  expect(manifest.unreadableTables).toEqual([]);
  const exported = strFromU8(zip["customers-import.csv"]!);
  expect(exported).toContain("Marisol Quintero");

  // FR-EXP-03: the export starts a new business with the same totals.
  const fresh = await newBusiness();
  const other = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL });
  const page2 = await other.newPage();
  await signInAs(page2, fresh.email);
  await page2.goto("/settings/import");
  await page2.getByLabel("Customer list (CSV)").setInputFiles({ name: "customers-import.csv", mimeType: "text/csv", buffer: Buffer.from(exported) });
  await page2.getByRole("button", { name: "Upload and match columns" }).click();
  await expect(page2.getByText(/from Our own export/)).toBeVisible();
  await page2.getByRole("button", { name: "Check every row" }).click();
  await expect(stat(page2, "New customers")).toHaveText("3");
  await expect(stat(page2, "Active plans")).toHaveText("1");
  await expect(stat(page2, "Open balances")).toHaveText("$45.50");
  await page2.getByRole("button", { name: "Import 3 customers" }).click();
  await expect(page2.getByText("Everything in the file is here.")).toBeVisible();
  const [again] = await adminQuery<{ customers: number; balance: number }>(
    `select (select count(*)::int from public.customers where tenant_id = $1) as customers,
            (select coalesce(sum(amount_cents), 0)::int from public.ledger_entries where tenant_id = $1) as balance`,
    [fresh.tenantId],
  );
  expect(again).toEqual({ customers: 3, balance: 3550 });
  await other.close();

  // Undo the first import (FR-MIG-14): its customers, plans and visits go.
  await page.goto("/settings/import");
  await page.getByRole("row").filter({ hasText: "Imported" }).getByRole("link").click();
  await page.getByRole("button", { name: "Undo this import" }).click();
  await page.getByRole("button", { name: "Yes, undo the import" }).click();
  await expect(page.getByText("Import undone. 3 customers removed with their addresses, plans and visits.").first()).toBeVisible();
  const [after] = await adminQuery<{ n: number; visits: number; ledger: number }>(
    `select (select count(*)::int from public.customers where tenant_id = $1) as n,
            (select count(*)::int from public.appointments where tenant_id = $1) as visits,
            (select count(*)::int from public.ledger_entries where tenant_id = $1) as ledger`,
    [day.tenantId],
  );
  expect(after).toEqual({ n: 0, visits: 0, ledger: 0 });
});

test("PRD 9.5: 3,000 customers go from upload to reconciled well inside 15 minutes", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const day = await newBusiness();
  await signInAs(page, day.email);
  const rows = Array.from({ length: 3000 }, (_, i) => `${5000 + i},Customer ${i},${100 + i} N Main St,Orem,UT,84057,c${i}@example.com,801555${String(1000 + (i % 9000)).padStart(4, "0")},Quarterly Pest,${NEXT_US},`);
  const started = Date.now();
  await page.goto("/settings/import");
  await page.getByLabel("Customer list (CSV)").setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.from([CSV.split("\r\n")[0], ...rows].join("\r\n")) });
  await page.getByRole("button", { name: "Upload and match columns" }).click();
  await page.getByRole("button", { name: "Check every row" }).click();
  await expect(stat(page, "New customers")).toHaveText("3000", { timeout: 120_000 });
  await page.getByRole("button", { name: "Import 3000 customers" }).click();
  await expect(page.getByText("Everything in the file is here.")).toBeVisible({ timeout: 14 * 60_000 });
  const seconds = Math.round((Date.now() - started) / 1000);
  test.info().annotations.push({ type: "duration", description: `${seconds} s for 3,000 customers` });
  console.log(`PRD 9.5: 3,000 customers imported in ${seconds} s`);
  expect(seconds).toBeLessThan(15 * 60);
});
