import "server-only";
import { sql } from "kysely";
import { pool } from "./client";
import { IDLE_IN_TX_TIMEOUT, timedTx, type Tx } from "./rls";

// Bypasses RLS. Allowed only in background jobs, webhook handlers and the
// local-auth bootstrap; ESLint blocks imports from app/ and components/.
// Every query here must filter by tenant_id explicitly.

const JOB_STATEMENT_TIMEOUT = "15s";

export async function withServiceRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return timedTx("service", null, () =>
    pool()
      .transaction()
      .execute(async (tx) => {
        await sql`select
        set_config('statement_timeout', ${JOB_STATEMENT_TIMEOUT}, true),
        set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TX_TIMEOUT}, true),
        set_config('role', 'service_role', true)`.execute(tx);
        return fn(tx);
      }),
  );
}
