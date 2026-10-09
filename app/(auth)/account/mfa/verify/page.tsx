import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth-mode";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "../../../sign-in/actions";
import { Button } from "@/components/ui/button";
import { CodeForm } from "../code-form";
import { verifyMfa } from "../actions";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function MfaVerifyPage() {
  await requireUser();
  if (authMode() === "local") redirect("/app");
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Enter your code</h1>
        <p className="max-w-[52ch] text-fg-muted">Open your authenticator app and enter the 6-digit code for RouteKeep. If you lose your phone, contact support.</p>
      </div>
      <CodeForm action={verifyMfa} submitLabel="Continue" />
      <form action={signOut}>
        <Button variant="link" type="submit">
          Sign out
        </Button>
      </form>
    </div>
  );
}
