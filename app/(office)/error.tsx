"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// NFR-06: the digest ties this screen to the server's log line for the same failure.
export default function OfficeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "office render failed", digest: error.digest ?? null }));
  }, [error]);
  return (
    <main className="mx-auto grid max-w-md gap-4 p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-fg-muted">This page could not load. Try again, and if it keeps happening tell us the code {error.digest ?? "none"}.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
