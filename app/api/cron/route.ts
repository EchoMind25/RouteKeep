import { timingSafeEqual } from "node:crypto";
import { PRIVATE } from "@/lib/auth/api";
import { env } from "@/lib/env";
import { autopayEveryone, billEveryone, generateEveryone, reconcileEveryone, remindAll } from "@/lib/jobs/daily";
import { processOutbox } from "@/lib/jobs/outbox";

// For a scheduler other than Inngest (a GitHub Action, a Netlify scheduled
// function, cron on any box): POST /api/cron?job=generation|outbox|reminders|billing|autopay|reconcile
// with "Authorization: Bearer <CRON_SECRET>". Off when CRON_SECRET is unset.
// generation is the FR-SUB-02 fallback that keeps the 60-day window rolling
// without Inngest; inserts are idempotent, so a timed-out run is safe to repeat.
const JOBS: Record<string, () => Promise<unknown>> = {
  generation: () => generateEveryone(),
  outbox: () => processOutbox({ limit: 200 }),
  reminders: () => remindAll(),
  billing: async () => (await billEveryone()).length,
  autopay: () => autopayEveryone(),
  reconcile: () => reconcileEveryone(),
};

export async function POST(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response(null, { status: 404, headers: PRIVATE });
  const job = new URL(request.url).searchParams.get("job") ?? "";
  const run = Object.hasOwn(JOBS, job) ? JOBS[job] : undefined;
  if (!run) return new Response("Unknown job", { status: 400, headers: PRIVATE });
  return Response.json({ job, result: await run() }, { headers: PRIVATE });
}
