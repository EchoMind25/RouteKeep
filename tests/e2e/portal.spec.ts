import { randomUUID } from "node:crypto";
import { addDaysTo, adminQuery, denverToday, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";
import { linkIn, mailTo } from "./mail";
import { pdfText } from "./pdf";

// M6: email after a finished visit, the customer portal (sign-in by link,
// history with records, invoices, request service), unsubscribe, and a
// reminder held back for an unsubscribed customer (FR-MSG-01/04/05, FR-POR-01/02).

test("M6: service complete email, portal sign-in, records, request service, unsubscribe", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const started = Date.now();
  const today = denverToday();
  const day = await seedDispatchDay({
    date: today,
    techs: ["Rowan Achterberg"],
    techLogins: [0],
    stops: [
      { name: "Marisol Quintero", lat: OFFICE.lat, lng: OFFICE.lng + 0.01, tech: 0 },
      { name: "Bo Neighbor", lat: OFFICE.lat, lng: OFFICE.lng + 0.02, tech: 0 },
    ],
  });
  const [mine, theirs] = day.stopIds as [string, string];
  const email = `marisol-${randomUUID().slice(0, 8)}@example.com`;
  await adminQuery("update public.customers set email = $2, first_name = 'Marisol' where id = $1", [day.customerIds[0], email]);

  // The technician finishes Marisol's stop; the email follows on its own.
  const phone = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tech = await phone.newPage();
  await signInAs(tech, day.techEmails[0]!);
  const finish = (id: string) => ({ kind: "complete", key: `complete-${randomUUID()}`, appointmentId: id, date: today, at: new Date().toISOString(), applications: [], checklist: [], notes: null, payment: { method: "invoice_later" } });
  const sent = await tech.request.post("/api/tech/upload", { data: { protocol: 1, mutations: [finish(mine), finish(theirs)] } });
  expect(((await sent.json()) as { results: { status: string }[] }).results.map((r) => r.status)).toEqual(["applied", "applied"]);
  await phone.close();
  const done = await mailTo(email, /^Service complete/, started);
  expect(done.text).toContain("Hi Marisol,");
  expect(done.text).toContain("Dispatch Test Pest, pesticide business license UT-BUS-0001");
  expect(done.text).toContain("Sent with RouteKeep");

  // The record link asks her to sign in first; she asks for a link by email.
  await page.goto(linkIn(done.text, /https?:\/\/\S+\/visits\/\S+/));
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await expect(page.getByText("Dispatch Test Pest").first()).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Email").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(`If ${email} is on file, a sign-in link is on its way.`)).toBeVisible();
  // An unknown address gets the same answer and no email.
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("If nobody@example.com is on file")).toBeVisible();

  const signIn = await mailTo(email, /^Your sign-in link/, started);
  expect(signIn.text).not.toContain("Stop these emails");
  const link = linkIn(signIn.text, /https?:\/\/\S+\/auth\?token=\S+/);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Hi Marisol" })).toBeVisible();
  await expectAccessible(page);
  // The link works once.
  const again = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await again.newPage();
  await other.goto(link);
  await expect(other.getByText("That link has expired or was already used.")).toBeVisible();
  await again.close();

  // Her record, as a PDF; the neighbour's is not hers to see.
  const history = page.getByRole("region", { name: "Service history" });
  const recordHref = await history.getByRole("link", { name: /Service record/ }).first().getAttribute("href");
  const pdf = await page.request.get(recordHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdfText(await pdf.body())).toContain("Marisol Quintero");
  expect((await page.request.get(recordHref!.replace(mine, theirs))).status()).toBe(404);

  // Request service; the office sees it.
  await page.getByLabel("What do you need?").fill("Wasps by the back door");
  await page.getByLabel(/Good days or times/).fill("Weekday mornings");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Sent. The office will call or email you to set a time.")).toBeVisible();
  const office = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const desk = await office.newPage();
  await signInAs(desk, day.email);
  await desk.goto("/customers");
  await expect(desk.getByText("1 service request")).toBeVisible();
  await desk.getByRole("link", { name: "Marisol Quintero" }).first().click();
  await expect(desk.getByRole("region", { name: "Service requests" })).toContainText("Wasps by the back door");
  await expect(desk.getByRole("list", { name: "Messages" })).toContainText("Service complete");
  await expectAccessible(desk);
  await desk.goto("/settings/messages");
  await expect(desk.getByText("Test mode: emails are written to files on this computer, not sent.")).toBeVisible();
  await expectAccessible(desk);

  // Unsubscribe (FR-MSG-04): visiting the page changes nothing; the button does.
  await page.goto(linkIn(done.text, /https?:\/\/\S+\/u\/\S+/));
  const [before] = await adminQuery<{ at: Date | null }>("select email_unsubscribed_at as at from public.customers where id = $1", [day.customerIds[0]]);
  expect(before!.at).toBeNull();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByText("You won't get reminders")).toBeVisible();

  // Tomorrow's reminder for her is held back, with the reason on record.
  await adminQuery(
    `insert into public.appointments (tenant_id, customer_id, property_id, service_type_id, technician_id, status, local_date, tz, duration_min, price_cents)
     select tenant_id, customer_id, property_id, service_type_id, technician_id, 'scheduled', $2::date, tz, 30, 0 from public.appointments where id = $1`,
    [mine, addDaysTo(today, 1)],
  );
  const cron = await page.request.post("/api/cron?job=reminders", { headers: { Authorization: "Bearer e2e-cron-secret-not-real-1234" } });
  expect(cron.status()).toBe(200);
  const [held] = await adminQuery<{ status: string; suppressed_reason: string }>(
    "select status, suppressed_reason from public.messages where customer_id = $1 and template = 'appointment_reminder'",
    [day.customerIds[0]],
  );
  expect(held).toEqual({ status: "suppressed", suppressed_reason: "The customer unsubscribed" });
  expect((await page.request.post("/api/cron?job=reminders")).status()).toBe(404);
  await office.close();
});
