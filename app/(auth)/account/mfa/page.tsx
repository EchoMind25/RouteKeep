import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/auth-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";
import { removeFactor } from "./actions";

export const metadata: Metadata = { title: "Two-step sign-in" };

// CR-15: owners and admins list, add and remove authenticator apps. A lost
// phone with only one factor is a support request, not a self-service reset.
export default async function MfaManagePage() {
  const member = await requireMember(["owner", "admin"]);
  if (authMode() === "local") redirect("/settings/team");
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.mfa.listFactors();
  const factors = data?.totp ?? [];
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Two-step sign-in</h1>
        <p className="max-w-[56ch] text-fg-muted">
          Signed in as {member.email}. Add a second device so losing one phone does not lock you out. If you lose your only phone, contact support.
        </p>
      </div>
      <ul className="grid gap-2" aria-label="Authenticator apps">
        {factors.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line px-4 py-3">
            <span className="flex items-center gap-2">
              <span className="font-medium">{f.friendly_name ?? "Authenticator app"}</span>
              <Badge tone="success">On</Badge>
            </span>
            {factors.length > 1 ? (
              <form action={removeFactor}>
                <input type="hidden" name="factorId" value={f.id} />
                <Button variant="secondary" size="sm" type="submit">
                  Remove
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/account/mfa/enroll">Add another</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/settings/team">Back to team</Link>
        </Button>
      </div>
    </div>
  );
}
