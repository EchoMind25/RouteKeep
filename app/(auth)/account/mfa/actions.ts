"use server";

// CR-15: second factor (Supabase Auth TOTP) for owners and admins. These only
// need a signed-in user, not a member: they are where a blocked owner lands.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth-mode";
import { requireUser } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";

export interface EnrolState {
  factorId?: string;
  qr?: string;
  secret?: string;
  error?: string;
}

export interface CodeState {
  error?: string;
}

async function client() {
  await requireUser();
  if (authMode() === "local") redirect("/app");
  return supabaseServer();
}

function readCode(data: FormData): string | null {
  const code = String(data.get("code") ?? "").replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

/** Where to go once a code is accepted: back to the factor list if already at aal2, else into the app. */
async function landing(supabase: Awaited<ReturnType<typeof supabaseServer>>): Promise<string> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2" ? "/account/mfa" : "/app";
}

export async function startEnrol(): Promise<EnrolState> {
  const supabase = await client();
  // Abandoned set-ups would pile up and block a fresh one; drop them first.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${crypto.randomUUID().slice(0, 6)}` });
  if (error || !data) return { error: "We could not start set-up. Try again in a moment." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnrol(_prev: CodeState & { factorId?: string }, data: FormData): Promise<CodeState & { factorId?: string }> {
  const factorId = String(data.get("factorId") ?? "");
  const code = readCode(data);
  if (!code) return { factorId, error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await client();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { factorId, error: "That code is wrong or has expired. Enter the current code." };
  redirect(await landing(supabase));
}

export async function verifyMfa(_prev: CodeState, data: FormData): Promise<CodeState> {
  const code = readCode(data);
  if (!code) return { error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await client();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect("/account/mfa/enroll");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code is wrong or has expired. Enter the current code." };
  redirect("/app");
}

/** Removes one factor; the last verified one stays (Supabase also needs aal2 for this). */
export async function removeFactor(data: FormData): Promise<void> {
  const supabase = await client();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if ((factors?.totp.length ?? 0) < 2) return;
  await supabase.auth.mfa.unenroll({ factorId: String(data.get("factorId") ?? "") });
  revalidatePath("/account/mfa");
}
