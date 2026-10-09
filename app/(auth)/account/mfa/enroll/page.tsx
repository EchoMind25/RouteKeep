import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth-mode";
import { requireUser } from "@/lib/auth/session";
import { EnrolFlow } from "./enrol-flow";

export const metadata: Metadata = { title: "Set up two-step sign-in" };

export default async function MfaEnrolPage() {
  await requireUser();
  if (authMode() === "local") redirect("/app");
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Set up two-step sign-in</h1>
        <p className="max-w-[56ch] text-fg-muted">
          Owners and admins sign in with a code from an authenticator app as well as an emailed code. If you lose your phone, contact support.
        </p>
      </div>
      <EnrolFlow />
    </div>
  );
}
