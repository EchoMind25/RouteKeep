import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import { pdfText } from "./pdf";

// FR-REC-06: product usage by date range, product, EPA number and technician,
// on screen and as CSV and PDF, from the records as saved; an amended record
// counts once (FR-REC-03); business name and license on the PDF (CR-03).

const minusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

interface Line {
  product: number;
  total: number;
  unit: "gal" | "fl_oz";
  statement?: boolean;
}

/** Completes a stop through the technician sync API with these product lines, applied at 8:00 that day in Denver. */
async function complete(tech: Page, stopId: string, date: string, productIds: string[], lines: Line[]) {
  const at = `${date}T14:00:00.000Z`;
  const response = await tech.request.post("/api/tech/upload", {
    data: {
      protocol: 1,
      mutations: [
        {
          kind: "complete",
          key: `complete-${randomUUID()}`,
          appointmentId: stopId,
          date,
          at,
          applications: lines.map((l) => ({
            key: `app-${randomUUID()}`,
            productId: productIds[l.product],
            mixRate: 0.5,
            mixUnit: "fl_oz_per_gal",
            totalAmount: l.total,
            amountUnit: l.unit,
            areaTreated: 1000,
            areaUnit: "sq_ft",
            targetSites: ["Foundation perimeter"],
            targetPests: ["Ants"],
            appliedAt: at,
            capturedAt: at,
            customerStatementAt: l.statement ? at : null,
          })),
          checklist: [],
          notes: null,
          payment: { method: "invoice_later" },
        },
      ],
    },
  });
  expect(((await response.json()) as { results: { status: string }[] }).results[0]!.status).toBe("applied");
}

test("FR-REC-06: product usage by range, product and technician, as CSV and PDF; amendments count once", async ({ page, browser }) => {
  const today = denverToday();
  const [d0, d1, d2, d3] = [today, minusDays(today, 1), minusDays(today, 2), minusDays(today, 3)];
  const day = await seedDispatchDay({
    date: today,
    techs: ["Anika Sorensen", "Bo Lindqvist"],
    techLogins: [0, 1],
    products: [
      { name: "Usage Test Perimeter", epaRegNo: "279-3206" },
      { name: "Usage Test Fumigant", epaRegNo: "5481-541", signalWord: "danger", restrictedUse: true },
    ],
    stops: [
      { name: "Two Days Ago Home", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0, date: d2 },
      { name: "Yesterday Home", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0, date: d1 },
      { name: "Today Home", lat: OFFICE.lat, lng: OFFICE.lng + 0.03, tech: 1, date: d0 },
      { name: "Before The Range Home", lat: OFFICE.lat, lng: OFFICE.lng + 0.04, tech: 1, date: d3 },
    ],
  });
  const [s2, s1, s0, s3] = day.stopIds as [string, string, string, string];

  for (const [index, work] of [
    [0, [[s2, d2, [{ product: 0, total: 1.5, unit: "gal" }]], [s1, d1, [{ product: 0, total: 1, unit: "gal" }, { product: 1, total: 16, unit: "fl_oz", statement: true }]]]],
    [1, [[s0, d0, [{ product: 0, total: 64, unit: "fl_oz" }]], [s3, d3, [{ product: 0, total: 9, unit: "gal" }]]]],
  ] as [number, [string, string, Line[]][]][]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const tech = await context.newPage();
    await signInAs(tech, day.techEmails[index]!);
    for (const [stop, date, lines] of work) await complete(tech, stop, date, day.productIds, lines);
    if (index === 1) {
      // Technicians cannot pull the report.
      expect((await tech.request.get(`/api/reports/product-usage?from=${d2}&to=${d0}`)).status()).toBe(403);
    }
    await context.close();
  }

  // The first record was keyed wrong and amended after the 24 hour lock: it counts once, as amended.
  const [original] = await adminQuery<{ id: string }>("select a.id from public.applications a where a.appointment_id = $1", [s2]);
  await adminQuery(
    `insert into public.applications (tenant_id, appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
       business_name, business_address, business_license_no, applicator_name, applicator_license_no, product_name, product_kind, epa_reg_no,
       signal_word, restricted_use, mix_rate, mix_unit, total_amount, amount_unit, area_treated, area_unit, target_sites, target_pests, applied_at,
       client_key, amended_from, amendment_reason)
     select tenant_id, appointment_id, product_id, technician_id, customer_name, customer_address, application_address,
       business_name, business_address, business_license_no, applicator_name, applicator_license_no, product_name, product_kind, epa_reg_no,
       signal_word, restricted_use, mix_rate, mix_unit, 1.25, amount_unit, area_treated, area_unit, target_sites, target_pests, applied_at,
       'amend-e2e-' || gen_random_uuid(), id, 'Total was keyed wrong'
     from public.applications where id = $1`,
    [original!.id],
  );

  await signInAs(page, day.email);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" }).click();
  await page.getByRole("link", { name: /Product usage/ }).click();
  await expect(page.getByRole("heading", { name: "Product usage", level: 1 })).toBeVisible();
  // With no dates chosen: this month so far.
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(`${today.slice(0, 8)}01`);
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(today);

  await page.getByLabel("From", { exact: true }).fill(d2);
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${d2}`));
  const totals = page.getByRole("region", { name: "Totals by product" });
  await expect(totals.getByRole("row")).toHaveText([
    /^Product\s*EPA registration no\.\s*Applications\s*Total applied$/,
    /^Usage Test Fumigant\s*Restricted use\s*5481-541\s*1\s*16 fl oz$/,
    /^Usage Test Perimeter\s*279-3206\s*3\s*2\.25 gal, 64 fl oz$/,
  ]);
  await expect(page.getByText("4 applications")).toBeVisible();
  const rows = page.getByRole("region", { name: "Each application" });
  await expect(rows.getByRole("row")).toHaveCount(5);
  await expect(rows.getByRole("row").filter({ hasText: "Two Days Ago Home" })).toContainText("Amended");
  await expect(rows.getByRole("row").filter({ hasText: "Before The Range Home" })).toHaveCount(0);
  await expectAccessible(page);

  // Narrowed to one technician, then to one product.
  await page.getByLabel("Technician", { exact: true }).selectOption({ label: "Bo Lindqvist" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(totals.getByRole("row")).toHaveText([/^Product/, /^Usage Test Perimeter\s*279-3206\s*1\s*64 fl oz$/]);
  await page.getByLabel("Technician", { exact: true }).selectOption({ label: "All technicians" });
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Usage Test Fumigant, EPA 5481-541" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(totals.getByRole("row")).toHaveText([/^Product/, /^Usage Test Fumigant/]);
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "All products" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByText("4 applications")).toBeVisible();

  // CSV: every CR-01 field, one line per current record, local time.
  const csvHref = await page.getByRole("link", { name: "CSV" }).getAttribute("href");
  const csv = await page.request.get(csvHref!);
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(csv.headers()["content-disposition"]).toBe(`attachment; filename="product-usage-${d2}-to-${d0}.csv"`);
  const text = (await csv.body()).toString("utf8");
  expect(text.startsWith("﻿Applied date,Applied time,Time zone,Applicator,Applicator license,Customer,Application address,Product,EPA registration no.,")).toBe(true);
  const lines = text.trim().split("\r\n");
  expect(lines).toHaveLength(5);
  expect(lines[1]).toMatch(new RegExp(`^${d2},08:00,America/Denver,Anika Sorensen,.*,Two Days Ago Home,.*,Usage Test Perimeter,279-3206,Caution,No,0\\.5,fl oz per gallon of mix,1\\.25,gal,1000,sq ft,Foundation perimeter,Ants,,Yes,`));
  expect(lines.find((l) => l.includes("Usage Test Fumigant"))).toMatch(new RegExp(`,Danger,Yes,.*,16,fl oz,.*,${d1} 08:00,No,`));

  // PDF: business name and license, the range, totals and each application.
  const pdfHref = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const body = pdfText(await pdf.body());
  for (const expected of ["Dispatch Test Pest", "Pesticide business license", "Product usage", "Totals by product", "Usage Test Fumigant (restricted use)", "2.25 gal, 64 fl oz", "Each application", "Two Days Ago Home", "Amended"]) {
    expect(body).toContain(expected);
  }
});
