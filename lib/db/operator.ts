import "server-only";
import { sql } from "kysely";
import type { DeveloperSession } from "@/lib/auth/session";
import { pool } from "./client";
import { IDLE_IN_TX_TIMEOUT, timedTx, type Tx } from "./rls";

// OPS-01: the developer console's only way into the database. It runs as
// `platform_operator`, which has no table privileges and can only call the
// app.ops_* functions (supabase/migrations/20261013090000_platform_operator.sql).
// Take a DeveloperSession so a caller has to have passed requireDeveloper first.

const STATEMENT_TIMEOUT = "15s";

export async function withOperator<T>(dev: DeveloperSession, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = { sub: dev.userId, email: dev.email, role: "platform_operator", aal: dev.claims.aal ?? null };
  return timedTx("operator", null, () =>
    pool()
      .transaction()
      .execute(async (tx) => {
        await sql`select
        set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
        set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true),
        set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TX_TIMEOUT}, true),
        set_config('role', 'platform_operator', true)`.execute(tx);
        return fn(tx);
      }),
  );
}
