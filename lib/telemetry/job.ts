import "server-only";
import { sql } from "kysely";
import { withServiceRole } from "@/lib/db/service";
import { errorText } from "@/lib/observability/log";
import { parseEvent, type EventName, type EventProps, type Surface } from "./events";
import { insertEvent, warnOnce } from "./track";

// OPS-03, OPS-04: events recorded by background work, which runs as
// service_role and so names the business itself. app.track_event still reads
// that business's data-sharing level and drops the event at `none`. Jobs only:
// ESLint keeps lib/db/service out of app/ and components/.

export async function trackForTenant<N extends EventName>(tenantId: string, name: N, props: EventProps<N>, surface: Surface = "job"): Promise<boolean> {
  try {
    const clean = parseEvent(name, props);
    if (!clean) {
      warnOnce(`invalid props for ${name}`);
      return false;
    }
    return await withServiceRole((tx) => insertEvent(tx, name, clean, surface, tenantId));
  } catch (error) {
    warnOnce(`job track failed for ${name}`, { error: errorText(error).slice(0, 200) });
    return false;
  }
}

/** OPS-03: retention. Raw events older than 180 days are deleted (contract section 6), in batches. */
export async function purgeProductEvents(): Promise<{ deleted: number }> {
  let deleted = 0;
  // A large backlog is deleted 50,000 rows at a time; stop after 20 batches and finish tomorrow.
  for (let i = 0; i < 20; i++) {
    const n = await withServiceRole(async (tx) => (await sql<{ n: number }>`select app.purge_product_events() as n`.execute(tx)).rows[0]?.n ?? 0);
    deleted += n;
    if (n < 50_000) break;
  }
  return { deleted };
}
