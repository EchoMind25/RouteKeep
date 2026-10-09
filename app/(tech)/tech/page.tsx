import type { Metadata } from "next";
import { headers } from "next/headers";
import { TechApp, THEME_SCRIPT } from "@/components/tech/tech-app";
import { requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { publicEnv } from "@/lib/public-env";
import { signOut } from "../../(auth)/sign-in/actions";
import { InterimDay } from "./interim";

export const metadata: Metadata = { title: "My route" };

// FR-TEC-01, FR-TEC-02: the technician app. The page carries no route data:
// everything comes from the phone's own copy, which syncs in the background,
// so the same page works offline from the service worker's cache.
export default async function TechPage() {
  const member = await requireMember();
  if (!isEnabled("offlineTechApp")) return <InterimDay member={member} />;
  // The inline theme script runs under the CSP nonce proxy.ts sets per request.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <form id="tech-sign-out" action={signOut} hidden />
      <TechApp userId={member.userId} appVersion={publicEnv.appVersion} />
    </>
  );
}
