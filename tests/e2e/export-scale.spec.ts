import { strFromU8, unzipSync } from "fflate";
import { adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, signInAs, test } from "./fixtures";

// FR-EXP-02: a 10,000-customer business exports in under 10 minutes. Slow, so
// it runs only when asked: RK_SLOW=1 npx playwright test export-scale.
// Known failing 2026-10-08: a month of ~4,000 records renders as one PDF and
// stalls the export; the fix is to split record PDFs into smaller parts.
test.skip(!process.env.RK_SLOW, "set RK_SLOW=1 to run the export timing test");

test("FR-EXP-02: 10,000 customers, 30,000 visits and 12,000 records export in under 10 minutes", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const day = await seedDispatchDay({ date: denverToday(), techs: ["Rowan Achterberg"], stops: [{ name: "Seed", lat: OFFICE.lat, lng: OFFICE.lng, tech: 0 }] });
  const t = day.tenantId;
  await adminQuery(
    `with c as (
       insert into public.customers (tenant_id, display_name, first_name, last_name, email, phone)
       select $1, 'Customer ' || g, 'Customer', g::text, 'c' || g || '@example.com', '+1801555' || lpad((g % 10000)::text, 4, '0')
       from generate_series(1, 10000) g returning id),
     p as (
       insert into public.properties (tenant_id, customer_id, address_line1, city, region, postal_code, location)
       select $1, c.id, (100 + row_number() over ()) || ' N Main St', 'Orem', 'UT', '84057',
              extensions.st_setsrid(extensions.st_makepoint(-111.69 + random() / 20, 40.29 + random() / 20), 4326)::extensions.geography
       from c returning id, customer_id)
     insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, technician_id, status, local_date, tz, duration_min, price_cents, completed_at, arrived_at)
     select $1, p.customer_id, p.id, a.service_type_id, a.technician_id, 'completed', current_date - (k * 30), 'America/Denver', 30, 12900, now() - make_interval(days => k * 30), now() - make_interval(days => k * 30)
     from p cross join generate_series(1, 3) k cross join (select service_type_id, technician_id from public.appointments where tenant_id = $1 limit 1) a`,
    [t],
  );
  await adminQuery(
    `insert into public.applications (tenant_id, imported, appointment_id, client_key, product_name, epa_reg_no, total_amount, amount_unit, applied_at, recorded_at, captured_at, applicator_name, applicator_license_no, customer_name, application_address, target_pests, target_sites)
     select tenant_id, true, id, 'seed-' || id, 'Perimeter concentrate', '279-3206', 1.5, 'gal', completed_at, completed_at, completed_at, 'Rowan Achterberg', 'UT-APP-1000', 'Customer', '100 N Main St, Orem', '{ants}', '{perimeter}'
     from public.appointments where tenant_id = $1 and status = 'completed' limit 12000`,
    [t],
  );
  await signInAs(page, day.email);
  await page.goto("/settings/export");
  const started = Date.now();
  await page.getByRole("button", { name: "Export everything" }).click();
  const link = page.getByRole("link", { name: "Download" }).first();
  await expect(link).toBeVisible({ timeout: 10 * 60_000 });
  const seconds = Math.round((Date.now() - started) / 1000);
  const zip = unzipSync(new Uint8Array(await (await page.request.get((await link.getAttribute("href"))!)).body()));
  const customers = strFromU8(zip["customers-import.csv"]!).trim().split("\r\n").length - 1;
  console.log(`FR-EXP-02: ${customers} customers exported in ${seconds} s, ${Object.keys(zip).length} files`);
  expect(customers).toBe(10_001);
  expect(seconds).toBeLessThan(600);
});
