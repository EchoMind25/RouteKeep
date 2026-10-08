import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth-mode";
import { getUserSession } from "@/lib/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const DEMO_ACCOUNTS = [
  { email: "owner@demo.routeverde.test", label: "Owner" },
  { email: "office@demo.routeverde.test", label: "Office" },
  { email: "tech.dez@demo.routeverde.test", label: "Technician" },
];

export default async function SignInPage() {
  if (await getUserSession()) redirect("/app");
  const local = authMode() === "local";
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="max-w-[52ch] text-fg-muted">New here? Use your work email and we will set up your business next.</p>
      </div>
      <SignInForm local={local} demoAccounts={local ? DEMO_ACCOUNTS : []} />
    </div>
  );
}
