import { createServer, type Server } from "node:http";
import type { Page } from "@playwright/test";
import { adminQuery, laneOrder, OFFICE, seedDispatchDay } from "./db";
import { expect, expectAccessible, signInAs, test } from "./fixtures";

// D-07 (revised 2026-10-07): the AI route planner, end to end, against a
// stand-in for the model API on 127.0.0.1:3199 (playwright.config.ts points
// the app there). The stand-in plays a model that measures the solver's order
// and submits it with a reason; the test checks what the app sent it (no
// names, addresses, coordinates or codes) and what the dispatcher sees.

const DAY = "2030-04-09";
const bodies: string[] = [];
let server: Server;

function reply(content: unknown[]) {
  return { id: `msg_${bodies.length}`, type: "message", role: "assistant", model: "stand-in", content, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 80 } };
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(raw);
      const body = JSON.parse(raw) as { messages: { role: string; content: unknown }[] };
      const first = body.messages[0]!.content as string;
      const solver = /Solver's best order \(.*\):\n(.+)/.exec(first)![1]!.split(", ");
      const noted = /(S\d+): [^\n]*Notes:/.exec(first)![1]!;
      const turn = body.messages.length;
      const out =
        turn === 1
          ? reply([{ type: "tool_use", id: "tu_1", name: "measure_route", input: { order: solver } }])
          : reply([
              {
                type: "tool_use",
                id: "tu_2",
                name: "submit_route",
                input: { order: solver, summary: `The solver's order already works; ${noted} waits for its afternoon window.`, reasons: [{ stop: noted, reason: "Note says after 2 pm." }] },
              },
            ]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((resolve) => server.listen(3199, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function openDay(page: Page) {
  await page.goto(`/schedule?date=${DAY}`);
  await page.getByRole("region", { name: "Map of the day's stops" }).locator("canvas").waitFor();
}

test("D-07: the AI planner proposes, explains, and saves only when the dispatcher does", async ({ page }) => {
  const day = await seedDispatchDay({
    date: DAY,
    techs: ["Anika Sorensen"],
    stops: [3, 1, 2].map((k) => ({ name: `Quintero East ${k}`, lat: OFFICE.lat, lng: OFFICE.lng + 0.012 * k, tech: 0 })),
  });
  const [, , late] = day.stopIds;
  await adminQuery("update public.appointments set window_start = '14:00', window_end = '17:00', notes = 'Call 801-555-0142 first' where id = $1", [late]);
  await adminQuery("update public.properties set access_notes = 'Gate code 4471. Not before 2 pm, dog out' where id = (select property_id from public.appointments where id = $1)", [late]);
  const seeded = await laneOrder(day.techIds[0]!, DAY);

  await signInAs(page, day.email);
  await openDay(page);
  await page.getByRole("button", { name: "Plan Anika Sorensen's route with AI" }).click();
  const dialog = page.getByRole("dialog", { name: "AI plan for Anika Sorensen" });
  await expect(dialog.getByText(/The solver's order already works; stop \d waits for its afternoon window\./)).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("list", { name: "Why stops moved" })).toContainText("Quintero East 2");
  await expect(dialog.getByRole("list", { name: "Why stops moved" })).toContainText("Note says after 2 pm.");
  await expect(dialog.getByText("Driving now")).toBeVisible();
  await expectAccessible(page);

  // NFR-08: aliases, kilometres and redacted notes only.
  const sent = bodies.join("\n");
  expect(sent).toContain("Not before 2 pm, dog out");
  for (const secret of ["Quintero", "4471", "801-555-0142", "Main St", String(OFFICE.lat), String(OFFICE.lat).slice(0, 6), ...day.stopIds]) expect(sent).not.toContain(secret);

  // Nothing changed until it is saved.
  expect(await laneOrder(day.techIds[0]!, DAY)).toEqual(seeded);
  await dialog.getByRole("button", { name: "Save this order" }).click();
  await expect(page.getByText(/New order saved for Anika Sorensen/)).toBeVisible();
  const [proposed] = await adminQuery<{ order: string[] }>("select result->'order' as order from public.route_ai_runs where tenant_id = $1", [day.tenantId]);
  expect(await laneOrder(day.techIds[0]!, DAY)).toEqual(proposed!.order);
  const [route] = await adminQuery<{ optimizer: string }>("select optimizer from public.routes where technician_id = $1 and local_date = $2", [day.techIds[0], DAY]);
  expect(route!.optimizer).toBe("ai");
  const [run] = await adminQuery<{ status: string; turns: number }>("select status, (state->>'turns')::int as turns from public.route_ai_runs where tenant_id = $1", [day.tenantId]);
  expect(run).toEqual({ status: "done", turns: 2 });
});
