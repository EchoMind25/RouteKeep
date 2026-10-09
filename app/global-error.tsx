"use client";

import { useEffect } from "react";

// NFR-06: replaces the root layout when it fails, so it brings its own html and body.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "app render failed", digest: error.digest ?? null }));
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Something went wrong</h1>
        <p>The app could not load. Try again, and if it keeps happening tell us the code {error.digest ?? "none"}.</p>
        <button type="button" onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
