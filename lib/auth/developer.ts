// OPS-01: the developer console is for the people who run RouteVerde, not for
// any one business. Pure policy, kept apart from the session code so it can be
// tested without a database (like lib/auth/mfa.ts).
//
// Three things must all hold: the signed-in email is on DEVELOPER_EMAILS, that
// email was proven by the sign-in code (the session's first factor was an email
// code, not a password someone set on an unconfirmed sign-up), and (with
// Supabase) the session is at aal2. MFA_REQUIRED does not apply here: a developer always needs the second
// factor. Local sign-in has no second factor and only runs on this machine.

export type DeveloperStep = "deny" | "enroll" | "verify" | "allow";

/** DEVELOPER_EMAILS as a clean list: trimmed, lower-cased, de-duplicated, blanks dropped. */
export function parseDeveloperEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export function isDeveloperEmail(email: string | null | undefined, allowlist: readonly string[]): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

export interface DeveloperInput {
  email: string | null | undefined;
  allowlist: readonly string[];
  /** The session's authenticator assurance level claim; absent counts as aal1. */
  aal: string | undefined;
  hasVerifiedFactor: boolean;
  /** The token's `amr` claim: how this session signed in. */
  amr: unknown;
  /** True with Supabase sign-in; false only for local development sign-in. */
  secondFactorAvailable: boolean;
}

/** Whether the session's sign-in included a code sent to the email (Supabase `amr` methods "otp" or "magiclink"). */
export function signedInByEmailCode(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((m) => {
    const method = typeof m === "string" ? m : (m as { method?: unknown } | null)?.method;
    return method === "otp" || method === "magiclink";
  });
}

export function developerStep({ email, allowlist, aal, hasVerifiedFactor, amr, secondFactorAvailable }: DeveloperInput): DeveloperStep {
  if (!isDeveloperEmail(email, allowlist)) return "deny";
  // Local sign-in has neither an email code nor a second factor, and only runs on this machine.
  if (!secondFactorAvailable) return "allow";
  if (!signedInByEmailCode(amr)) return "deny";
  if (aal === "aal2") return "allow";
  return hasVerifiedFactor ? "verify" : "enroll";
}
