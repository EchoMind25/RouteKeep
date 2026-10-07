import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMemberSession, requireUser } from "@/lib/auth/session";
import { BusinessForm } from "./business-form";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await getMemberSession()) redirect("/app");
  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your business</h1>
        <p className="max-w-[60ch] text-fg-muted">
          Signed in as {user.email}. This takes about two minutes; you can change any of it later in Settings.
        </p>
      </div>
      <BusinessForm clientKey={crypto.randomUUID()} />
    </div>
  );
}
