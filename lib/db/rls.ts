import "server-only";
import { sql, type Transaction } from "kysely";
import { log } from "@/lib/observability/log";
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
// NFR-06 / ENG-12: a transaction left open by a stalled handler is ended by the server after 20 s.
export const IDLE_IN_TX_TIMEOUT = "20s";
const SLOW_TX_MS = 1000;

/** NFR-06: one `slow tx` line when a transaction helper takes over a second, so pool pressure shows up in logs. */
export async function timedTx<T>(kind: string, tenant: string | null, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    const ms = Math.round(performance.now() - t0);
    if (ms > SLOW_TX_MS) log.warn("slow tx", { msg: "slow tx", kind, ms, tenant });
  }
}

/**
 * Runs `fn` in one transaction as the `authenticated` role with the caller's
 * claims, so every query is filtered by the same RLS policies the pgTAP suite
 * tests. This is the only way request code reaches the database (ENG-08).
 */
export async function withRls<T>(claims: DbClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return timedTx("rls", claims.tenant_id ?? null, () =>
    pool()
      .transaction()
      .execute(async (tx) => {
        await sql`select
        set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
        set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true),
        set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TX_TIMEOUT}, true),
        set_config('role', 'authenticated', true)`.execute(tx);
        return fn(tx);
      }),
  );
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

/** M6: a signed-in portal customer. Set only from a verified portal session (lib/portal/session.ts). */
export interface PortalClaims {
  role: "portal";
  portal_tenant_id: string;
  portal_customer_id: string;
}

/**
 * Runs `fn` as the `portal` role: the only rows visible are the one
 * customer's (supabase/migrations/20261008140000_portal_messaging.sql).
 */
export async function withPortal<T>(claims: PortalClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return timedTx("portal", claims.portal_tenant_id, () =>
    pool()
      .transaction()
      .execute(async (tx) => {
        await sql`select
        set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
        set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true),
        set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TX_TIMEOUT}, true),
        set_config('role', 'portal', true)`.execute(tx);
        return fn(tx);
      }),
  );
}

/** Anonymous requests: as `anon`, which can only call the sign-in and unsubscribe functions. */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return timedTx("anon", null, () =>
    pool()
      .transaction()
      .execute(async (tx) => {
        await sql`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true), set_config('idle_in_transaction_session_timeout', ${IDLE_IN_TX_TIMEOUT}, true), set_config('role', 'anon', true)`.execute(tx);
        return fn(tx);
      }),
  );
}
