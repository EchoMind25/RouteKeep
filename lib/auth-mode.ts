// Readable from proxy.ts and server components alike (no secrets here).
export type AuthMode = "supabase" | "local";

export function authMode(): AuthMode {
  return process.env.AUTH_MODE === "local" ? "local" : "supabase";
}
