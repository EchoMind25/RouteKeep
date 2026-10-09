"use client";

import { analyticsPermitted, CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, type Consent, parseConsent, serializeConsent } from "@/lib/consent";

// CR-17: the browser side of consent. Any code that would measure in the
// browser checks analyticsAllowed() first and listens for CONSENT_EVENT.

export const CONSENT_EVENT = "rv:consent";
/** Fired by the footer's "Privacy choices" link to reopen the banner. */
export const OPEN_CHOICES_EVENT = "rv:privacy-choices";

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

export function gpcEnabled(): boolean {
  return typeof navigator !== "undefined" && navigator.globalPrivacyControl === true;
}

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return parseConsent(raw ? decodeURIComponent(raw) : null);
}

export function saveConsent(choice: Pick<Consent, "analytics" | "source">): Consent {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(choice)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  const saved = parseConsent(serializeConsent(choice))!;
  window.dispatchEvent(new CustomEvent<Consent>(CONSENT_EVENT, { detail: saved }));
  return saved;
}

/** False once the person picks "Essential only", and always while Global Privacy Control is on. */
export function analyticsAllowed(): boolean {
  return analyticsPermitted(readConsent(), gpcEnabled());
}

export function openPrivacyChoices() {
  window.dispatchEvent(new Event(OPEN_CHOICES_EVENT));
}
