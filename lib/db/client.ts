import "server-only";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "@/lib/env";
import type { DB } from "./schema";

// DATE stays "YYYY-MM-DD". pg's default turns it into a Date at local
// midnight, which shifts a day in any zone west of UTC (R-BUG-12).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// BIGINT (invoice numbers, sums of cents) as numbers, refusing silent precision loss.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${value} does not fit a JavaScript number`);
  return n;
});

const holder = globalThis as unknown as { __routekeepDb?: Kysely<DB> };

/**
 * The shared connection pool. Do not query it directly from request code:
 * use withRls (lib/db/rls.ts) so row level security applies, or
 * withServiceRole (lib/db/service.ts) in jobs and webhooks.
 */
export function pool(): Kysely<DB> {
  holder.__routekeepDb ??= new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: env().DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
        application_name: "routekeep",
      }),
    }),
  });
  return holder.__routekeepDb;
}
