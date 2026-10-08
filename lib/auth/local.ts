import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { sql } from "kysely";
import { cookies } from "next/headers";
import { pool } from "@/lib/db/client";
import type { DbClaims } from "@/lib/db/rls";
import { env } from "@/lib/env";
import type { UserSession } from "./session";

// Development and test sign-in (AUTH_MODE=local). env() refuses this mode unless
// the database is on this machine and the process is not a hosted deploy
// (lib/auth/local-guard.ts). Claims come from the same access token hook
// Supabase runs, so RLS sees exactly what it would in production.

const COOKIE = "rk_local_session";
const ISSUER = "routeverde-local";
const TTL_SECONDS = 12 * 60 * 60;

function signingKey(): Uint8Array {
  const e = env();
  if (e.AUTH_MODE !== "local" || !e.LOCAL_AUTH_SECRET) throw new Error("Local sign-in is not enabled");
  return new TextEncoder().encode(e.LOCAL_AUTH_SECRET);
}

export async function readLocalSession(): Promise<UserSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: "authenticated",
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || payload.role !== "authenticated") return null;
    const claims = payload as unknown as DbClaims;
    return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : null, claims };
  } catch {
    return null;
  }
}

async function claimsFor(userId: string, email: string): Promise<DbClaims> {
  const event = { user_id: userId, claims: { sub: userId, email, role: "authenticated", aud: "authenticated" } };
  const result = await sql<{ event: { claims: DbClaims } }>`
    select public.custom_access_token_hook(${JSON.stringify(event)}::jsonb) as event`.execute(pool());
  return result.rows[0]!.event.claims;
}

async function issue(userId: string, email: string): Promise<void> {
  const claims = await claimsFor(userId, email);
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(signingKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** Finds or creates the local login for an email (local mode only). */
export async function ensureLocalUser(email: string): Promise<string> {
  signingKey();
  const db = pool();
  const existing = await sql<{ id: string }>`select id from auth.users where email = ${email}`.execute(db);
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await sql<{ id: string }>`
    insert into auth.users (id, email, aud, role, email_confirmed_at)
    values (gen_random_uuid(), ${email}, 'authenticated', 'authenticated', now())
    returning id`.execute(db);
  return created.rows[0]!.id;
}

export async function signInLocal(email: string): Promise<void> {
  await issue(await ensureLocalUser(email), email);
}

/** Re-reads tenant and role claims, e.g. right after creating a tenant. */
export async function refreshLocalSession(): Promise<void> {
  const current = await readLocalSession();
  if (current) await issue(current.userId, current.email ?? "");
}

export async function signOutLocal(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
