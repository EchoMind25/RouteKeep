// Local sign-in exists so the app and its end-to-end tests run against a plain
// local Postgres with no Supabase project. It must never work anywhere else:
// it only runs when the database is on this machine and the process is not a
// hosted deploy. Both checks are independent; either one blocks it.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function localAuthBlockReason(input: { databaseUrl: string; netlify?: string; context?: string }): string | null {
  let host: string;
  try {
    host = new URL(input.databaseUrl).hostname;
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
  if (!LOOPBACK.has(host)) {
    return "Local sign-in only works against a database on this machine";
  }
  if (input.netlify === "true" || (input.context !== undefined && input.context !== "dev")) {
    return "Local sign-in is disabled on hosted deploys";
  }
  return null;
}
