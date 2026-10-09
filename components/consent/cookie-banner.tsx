"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Consent } from "@/lib/consent";
import { gpcEnabled, OPEN_CHOICES_EVENT, readConsent, saveConsent } from "@/lib/consent-client";
import { MEASURED, NEVER_MEASURED } from "@/lib/legal/policy";

// CR-17: the cookie and measurement banner. Asked on the first visit, before
// anything optional runs. It says exactly what would be recorded and why, gives
// both answers the same weight, and never asks a browser that sends Global
// Privacy Control (that signal is the answer: essential only). The footer's
// "Privacy choices" link reopens it. Not a modal: the page stays usable.
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Consent | null>(null);
  const [gpc, setGpc] = useState(false);

  useEffect(() => {
    const signal = gpcEnabled();
    let choice = readConsent();
    if (!choice && signal) choice = saveConsent({ analytics: false, source: "gpc" });
    // Reading the cookie has to wait for the browser; the server never renders the banner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGpc(signal);
    setCurrent(choice);
    setOpen(!choice);
    const reopen = () => {
      setCurrent(readConsent());
      setOpen(true);
    };
    window.addEventListener(OPEN_CHOICES_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CHOICES_EVENT, reopen);
  }, []);

  if (!open) return null;

  const choose = (analytics: boolean) => {
    setCurrent(saveConsent({ analytics, source: "banner" }));
    setOpen(false);
  };

  return (
    <section
      aria-labelledby="cookie-banner-title"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto grid max-h-[calc(100dvh-1.5rem)] max-w-xl gap-3 overflow-y-auto rounded-panel border border-line bg-surface p-4 text-fg shadow-overlay sm:bottom-5"
    >
      <h2 id="cookie-banner-title" className="font-semibold">
        Help us improve, anonymously?
      </h2>
      <p className="text-sm text-fg-muted">
        We only use the cookies needed to sign you in and keep the app working. If you allow it, your browser will also send us:
      </p>
      <ul className="grid gap-1 text-sm text-fg-muted">
        {MEASURED.map((m) => (
          <li key={m.what} className="ml-5 list-disc">
            <span className="font-medium text-fg">{m.what}</span>: {m.detail}, {m.why}.
          </li>
        ))}
      </ul>
      <p className="text-sm text-fg-muted">
        {NEVER_MEASURED} Your business must allow it too.{" "}
        <Link href="/cookies" className="font-medium text-fg underline underline-offset-4">
          Details
        </Link>
      </p>
      {gpc ? <p className="text-sm text-fg-muted">Your browser sends Global Privacy Control, so nothing is sent.</p> : null}
      {current ? <p className="text-sm text-fg-muted">Your current choice: {current.analytics && !gpc ? "allowed" : "essential only"}.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => choose(false)}>
          Essential only
        </Button>
        <Button variant="secondary" onClick={() => choose(true)} disabled={gpc}>
          Allow anonymous measurement
        </Button>
      </div>
    </section>
  );
}

/** "Privacy choices" for footers: reopens the banner. */
export function PrivacyChoicesLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CHOICES_EVENT))}>
      Privacy choices
    </button>
  );
}
