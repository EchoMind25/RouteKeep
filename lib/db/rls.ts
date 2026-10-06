import "server-only";
import { sql, type Transaction } from "kysely";
import { pool } from "./client";
import type { DB } from "./schema";

export type Tx = Transaction<DB>;

/** The verified JWT claims of the caller, exactly as Supabase's Data API would pass them. */
export interface DbClaims {
  sub: string;
  role: "authenticated";
  tenant_id?: string;
  user_role?: string;
  email?: string;
  [claim: string]: unknown;
}

// D-04 / ENG-12: no request may hold a connection for more than 20 s.
const STATEMENT_TIMEOUT = "15s";

/**
 * Runs `fn` in one transaction as the `authenticated` role with the caller's
 * claims, so every query is filtered by the same RLS policies the pgTAP suite
 * tests. This is the only way request code reaches the database (ENG-08).
 */
export async function withRls<T>(claims: DbClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return pool()
    .transaction()
    .execute(async (tx) => {
      await sql`select
        set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
        set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true),
        set_config('role', 'authenticated', true)`.execute(tx);
      return fn(tx);
    });
}

/** Postgres error helpers for turning constraint failures into form messages. */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  const e = error as { constraint?: unknown };
  return typeof e?.constraint === "string" ? e.constraint : undefined;
}
