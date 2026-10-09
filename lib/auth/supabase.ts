import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { DbClaims } from "@/lib/db/rls";
import { publicEnv } from "@/lib/public-env";
import type { UserSession } from "./session";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes them.
        }
      },
    },
  });
}

/** Verifies the access token's signature (getClaims), never trusts cookie contents as-is. */
export async function readSupabaseSession(): Promise<UserSession | null> {
  if (!publicEnv.supabaseUrl) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const claims = data.claims;
  if (claims.role !== "authenticated" || typeof claims.sub !== "string") return null;
  return { userId: claims.sub, email: claims.email ?? null, claims: claims as DbClaims };
}

/** CR-15: whether the signed-in user has a verified TOTP factor. */
export async function hasVerifiedFactor(): Promise<boolean> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.mfa.listFactors();
  // Fail closed to "no factor": the user is sent to enrol, never past the check.
  return !error && data.totp.length > 0;
}
