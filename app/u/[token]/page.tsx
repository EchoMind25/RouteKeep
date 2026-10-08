import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { appSecret } from "@/lib/env";
import { verify } from "@/lib/messaging/signed";
import { unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "Email preferences", robots: { index: false, follow: false } };

// FR-MSG-04: one button, no sign-in. A GET never changes anything, so link
// scanners in mail filters cannot unsubscribe anyone by visiting the page.
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const secret = appSecret();
  const valid = secret ? verify<{ t: string; c: string }>(token, secret) : null;
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md content-center gap-5 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Email preferences</h1>
      {!valid ? (
        <p className="text-fg-muted">This link is not valid. Use the link at the bottom of the most recent email.</p>
      ) : done ? (
        <p className="text-md">You won&apos;t get reminders, service notices or invoices by email anymore. To start them again, ask the business.</p>
      ) : (
        <form action={unsubscribeAction} className="grid gap-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-md">Stop reminders, service notices and invoices by email? You can still sign in to your account.</p>
          <div>
            <Button type="submit">Stop these emails</Button>
          </div>
        </form>
      )}
    </main>
  );
}
