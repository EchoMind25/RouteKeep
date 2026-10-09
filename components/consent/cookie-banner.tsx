"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Consent } from "@/lib/consent";
import { gpcEnabled, OPEN_CHOICES_EVENT, readConsent, saveConsent } from "@/lib/consent-client";

// CR-17: the cookie banner. Asks once, gives both answers the same weight, and
// never asks a browser that sends Global Privacy Control (that signal is the
// answer: essential only). The footer's "Privacy choices" link
// reopens it. Not a modal: the page stays usable while it is open.
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
      className="fixed inset-x-3 bottom-3 z-40 mx-auto grid max-w-xl gap-3 rounded-panel border border-line bg-surface p-4 text-fg shadow-overlay sm:bottom-5"
    >
      <h2 id="cookie-banner-title" className="font-semibold">
        Cookies on this site
      </h2>
      <p className="text-sm text-fg-muted">
        We use only the cookies needed to sign you in and keep the app working. We also count errors and feature use anonymously, with no cookies and nothing that identifies you, so we can fix
        and improve the app. Choose Essential only to stop your browser sending it. No advertising, and we never sell data.{" "}
        <Link href="/cookies" className="font-medium text-fg underline underline-offset-4">
          Cookie policy
        </Link>
      </p>
      {gpc ? <p className="text-sm text-fg-muted">Your browser sends Global Privacy Control, so anonymous measurement stays off.</p> : null}
      {current ? <p className="text-sm text-fg-muted">Your current choice: {current.analytics && !gpc ? "essential and anonymous measurement" : "essential only"}.</p> : null}
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
