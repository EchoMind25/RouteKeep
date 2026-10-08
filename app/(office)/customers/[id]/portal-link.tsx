"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendPortalLinkAction } from "./account-actions";

export function PortalLinkButton({ customerId, disabled }: { customerId: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button variant="secondary" size="sm" disabled={disabled || pending} loading={pending} onClick={() => start(async () => setResult(await sendPortalLinkAction({ customerId })))}>
          Email a sign-in link
        </Button>
      </div>
      {result ? (
        <p role="status" className={result.ok ? "text-sm text-success" : "text-sm text-danger"}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
