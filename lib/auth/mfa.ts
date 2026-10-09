// CR-15: owners and admins sign in with a second factor (TOTP). Pure policy,
// kept apart from the session code so it can be tested without a database.
// Other roles are not forced: CR-15 scopes MFA to owner and admin.

export type MfaStep = "allow" | "enroll" | "verify";

export interface MfaInput {
  role: string;
  /** The session's authenticator assurance level claim; absent counts as aal1. */
  aal: string | undefined;
  hasVerifiedFactor: boolean;
  /** Off in local development (AUTH_MODE=local), on with Supabase. */
  required: boolean;
}

export function mfaStep({ role, aal, hasVerifiedFactor, required }: MfaInput): MfaStep {
  if (!required || (role !== "owner" && role !== "admin")) return "allow";
  if (aal === "aal2") return "allow";
  return hasVerifiedFactor ? "verify" : "enroll";
}

export const MFA_PATH: Record<Exclude<MfaStep, "allow">, string> = {
  enroll: "/account/mfa/enroll",
  verify: "/account/mfa/verify",
};

export function mfaBlockedMessage(step: Exclude<MfaStep, "allow">): string {
  return step === "enroll"
    ? "Set up two-step sign-in to continue (open /account/mfa/enroll)."
    : "Enter your authenticator code to continue (open /account/mfa/verify).";
}
