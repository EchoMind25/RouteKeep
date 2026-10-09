"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/layout";
import { confirmEnrol, startEnrol, type EnrolState } from "../actions";
import { CodeForm } from "../code-form";

export function EnrolFlow() {
  const [setup, setSetup] = useState<EnrolState | null>(null);
  const [pending, start] = useTransition();

  if (!setup?.factorId) {
    return (
      <div className="grid gap-4">
        {setup?.error ? <Alert tone="danger">{setup.error}</Alert> : null}
        <div>
          <Button type="button" loading={pending} onClick={() => start(async () => setSetup(await startEnrol()))}>
            Set up authenticator app
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <ol className="grid gap-5">
        <li className="grid gap-3">
          <p className="font-medium">1. Scan this code with an authenticator app</p>
          {/* Supabase returns an SVG data URI; next/image adds nothing here. */}
          {/* Not a token on purpose: a QR code needs a white quiet zone to scan, in dark mode too. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code to add RouteVerde to your authenticator app" width={192} height={192} className="rounded-control border border-line bg-white p-2" />
          <p className="text-sm text-fg-muted">
            Can&apos;t scan it? Enter this key by hand: <code className="select-all break-all font-mono text-fg">{setup.secret}</code>
          </p>
        </li>
        <li className="grid gap-3">
          <p className="font-medium">2. Enter the 6-digit code it shows</p>
          <CodeForm action={confirmEnrol} factorId={setup.factorId} submitLabel="Turn on" />
        </li>
      </ol>
    </div>
  );
}
