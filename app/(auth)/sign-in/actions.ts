"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authMode } from "@/lib/auth-mode";
import { signInLocal, signOutLocal } from "@/lib/auth/local";
import { supabaseServer } from "@/lib/auth/supabase";
import { normalizeEmail } from "@/lib/domain/contact";

export interface SignInState {
  step: "email" | "code";
  email?: string;
  error?: string;
}

const emailSchema = z.string().transform((v, ctx) => {
  try {
    return normalizeEmail(v);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
});

export async function startSignIn(_prev: SignInState, data: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(data.get("email") ?? "");
  if (!parsed.success) return { step: "email", error: parsed.error.issues[0]!.message };
  const email = parsed.data;

  if (authMode() === "local") {
    await signInLocal(email);
    redirect("/");
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    return { step: "email", email, error: error.status === 429 ? "Too many attempts. Wait a minute and try again." : "We could not send a code to that address." };
  }
  return { step: "code", email };
}

export async function verifyCode(_prev: SignInState, data: FormData): Promise<SignInState> {
  const email = String(data.get("email") ?? "");
  const token = String(data.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return { step: "code", email, error: "Enter the 6-digit code from the email." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, error: "That code is wrong or has expired. Request a new one." };
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (authMode() === "local") {
    await signOutLocal();
  } else {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/sign-in");
}
