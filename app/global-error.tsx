"use client";

import { useEffect } from "react";

// Replaces the root layout, so it brings its own document and uses no app styles.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("app error", error.digest);
  }, [error.digest]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "3rem 1rem" }}>
        <main style={{ maxWidth: "28rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
          <p>Please try again. If it keeps happening, reload the page.</p>
          <button type="button" onClick={() => retry()} style={{ minHeight: "2.75rem", padding: "0 1.25rem", fontSize: "1rem" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
