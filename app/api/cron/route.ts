import { timingSafeEqual } from "node:crypto";
import { PRIVATE } from "@/lib/auth/api";
import { env } from "@/lib/env";
import { autopayEveryone, billEveryone, reconcileEveryone, remindAll } from "@/lib/jobs/daily";
import { processOutbox } from "@/lib/jobs/outbox";

// For a scheduler other than Inngest (a GitHub Action, a Netlify scheduled
// function, cron on any box): POST /api/cron?job=outbox|reminders|billing|autopay|reconcile with
// "Authorization: Bearer <CRON_SECRET>". Off when CRON_SECRET is unset.
export async function POST(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response(null, { status: 404, headers: PRIVATE });
  const job = new URL(request.url).searchParams.get("job");
  const result =
    job === "outbox" ? await processOutbox({ limit: 200 }) : job === "reminders" ? await remindAll() : job === "billing"
          ? (await billEveryone()).length
          : job === "autopay"
            ? await autopayEveryone()
            : job === "reconcile"
              ? await reconcileEveryone()
              : null;
  if (result === null) return new Response("Unknown job", { status: 400, headers: PRIVATE });
  return Response.json({ job, result }, { headers: PRIVATE });
}
