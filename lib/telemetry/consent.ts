// OPS-03: each person's own choice in the cookie banner, opt-in (owner
// decision). The browser reporter sends only when the banner's cookie says
// analytics were accepted (rv_consent=v1.a1.*) and the browser does not signal
// Global Privacy Control. No cookie means no reports. Read only: nothing is
// ever written here.
//
// TODO: swap to analyticsAllowed() from lib/consent-client.ts once the banner
// branch lands; this is a stand-in with the same rule.

const CONSENT_COOKIE = "rv_consent";
/** The cookie value prefix that means "analytics accepted". Adjust here if the banner's format changes. */
export const ACCEPTED_PREFIX = "v1.a1.";
/** The window event the banner fires when the choice changes. */
export const CONSENT_EVENT = "rv:consent";

/** The value of one cookie in a document.cookie string, or null. */
export function cookieValue(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const raw = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/** Pure: whether analytics are allowed for this cookie string and GPC signal. */
export function analyticsAllowedFrom(cookies: string, globalPrivacyControl: unknown): boolean {
  if (globalPrivacyControl === true) return false;
  const v = cookieValue(cookies ?? "", CONSENT_COOKIE);
  return v !== null && v.startsWith(ACCEPTED_PREFIX);
}

/** In the browser: the current choice. False outside a browser. */
export function analyticsAllowed(): boolean {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  try {
    return analyticsAllowedFrom(document.cookie, (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
  } catch {
    return false;
  }
}
