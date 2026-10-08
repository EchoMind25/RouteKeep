"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/layout";

// Only the digest is logged: the message can carry customer data.
export default function OfficeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("office page error", error.digest);
  }, [error.digest]);
  return (
    <div className="grid max-w-xl gap-4">
      <Alert tone="danger" title="Something went wrong on this page">
        Your work elsewhere is safe. Try again, and if it keeps happening tell support
        {error.digest ? ` and quote ${error.digest}` : ""}.
      </Alert>
      <div>
        <Button onClick={() => retry()}>Try again</Button>
      </div>
    </div>
  );
}
