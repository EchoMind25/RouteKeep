"use client";

import { useEffect } from "react";
import { analyticsAllowed, CONSENT_EVENT } from "@/lib/telemetry/consent";
import { fingerprint, routePattern, scrubMessage } from "@/lib/telemetry/scrub";

// OPS-03, OPS-04: the browser half of error reporting. Rendered only by
// layouts whose business shares product data (not at `none`) and on the public
// site. It keeps nothing: no cookies, no storage, no ids; an in-memory count
// and the fingerprints already sent, both gone on the next page load. It also
// sends only with the person's opt-in from the banner and no Global Privacy Control
// (lib/telemetry/consent.ts), re-checked when the banner fires rv:consent.

type Kind = "error" | "unhandledrejection" | "boundary";

const MAX_PER_PAGE = 5;
let endpoint: string | null = null;
/** Which mounted reporter set the endpoint; a later mount takes over. */
let owner = 0;
/** The person's banner choice, re-read on mount and whenever it changes. */
let allowed = false;
let sentCount = 0;
const seen = new Set<string>();

function send(kind: Kind, error: unknown, fallbackMessage?: string) {
  if (!endpoint || !allowed || sentCount >= MAX_PER_PAGE || typeof window === "undefined") return;
  // Read again at send time too: the cookie may have changed without the event.
  if (!analyticsAllowed()) return;
  try {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : (fallbackMessage ?? "Non-error value thrown");
    const stack = error instanceof Error ? error.stack : undefined;
    const fp = fingerprint(kind, raw, stack);
    if (seen.has(fp)) return;
    seen.add(fp);
    sentCount++;
    const body = JSON.stringify({ kind, fingerprint: fp, message: scrubMessage(raw), route: routePattern(window.location.pathname) });
    // A string body goes as text/plain, which a beacon may send without a preflight.
    const queued = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(endpoint, body);
    if (!queued) {
      void fetch(endpoint, { method: "POST", body, keepalive: true, credentials: "same-origin", headers: { "content-type": "text/plain" } }).catch(() => {});
    }
  } catch {
    // Reporting must never raise an error of its own.
  }
}

/** For error boundaries. Sends nothing unless a reporter is mounted, so a business at `none` never sends. */
export function reportError(error: unknown, kind: Kind = "boundary") {
  send(kind, error);
}

export function ErrorReporter({ to = "/api/telemetry" }: { to?: string }) {
  useEffect(() => {
    const mine = ++owner;
    endpoint = to;
    const onError = (e: ErrorEvent) => {
      // Cross-origin scripts report only "Script error." with nothing to act on.
      if (!e.error && /^Script error\.?$/.test(e.message ?? "")) return;
      send("error", e.error ?? e.message, e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => send("unhandledrejection", e.reason);
    const onConsent = () => {
      allowed = analyticsAllowed();
    };
    onConsent();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => {
      window.removeEventListener(CONSENT_EVENT, onConsent);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      // Cleared a tick later, so the root error boundary (global-error), which
      // unmounts this in the same commit it mounts, can still report its error.
      setTimeout(() => {
        if (owner === mine) endpoint = null;
      }, 0);
    };
  }, [to]);
  return null;
}
