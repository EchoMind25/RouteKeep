// CR-17: cookie and browser-storage consent. Essential storage (sign-in, the
// offline technician app, this choice itself) needs no consent and is always on.
// Anonymous product measurement is opt-in twice: the business must allow it
// (tenants.data_sharing) and each person must choose "Allow" in the banner,
// which says exactly what is recorded. Global Privacy Control turns it off
// without asking (owner decision 2026-10-09). Shared by the banner (client) and the server.

export const CONSENT_COOKIE = "rv_consent";
/** Bump when a new optional category is added, so everyone is asked again. */
export const CONSENT_VERSION = 1;
/** How long a choice lasts before we ask again: 12 months. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface Consent {
  /** Anonymous product measurement in the browser (errors, speed, feature use). No cookies, no ids. */
  analytics: boolean;
  /** How the choice was made, for the record: the banner or the browser's GPC signal. */
  source: "banner" | "gpc";
  version: number;
}

export const ESSENTIAL_ONLY: Omit<Consent, "source"> = { analytics: false, version: CONSENT_VERSION };

/** "v1.a0.banner" -> Consent. Anything malformed or from an older version is no choice at all. */
export function parseConsent(value: string | undefined | null): Consent | null {
  if (!value) return null;
  const m = /^v(\d+)\.a([01])\.(banner|gpc)$/.exec(value);
  if (!m || Number(m[1]) !== CONSENT_VERSION) return null;
  return { version: CONSENT_VERSION, analytics: m[2] === "1", source: m[3] as Consent["source"] };
}

export function serializeConsent(c: Pick<Consent, "analytics" | "source">): string {
  return `v${CONSENT_VERSION}.a${c.analytics ? 1 : 0}.${c.source}`;
}

/**
 * Whether this person's browser may send anonymous measurement (the business
 * setting is checked separately, on the server). Only after they chose "Allow";
 * GPC always wins, even over an earlier "allow", because it is the visitor's
 * standing instruction (CCPA regs 7025).
 */
export function analyticsPermitted(consent: Consent | null, gpc: boolean): boolean {
  if (gpc) return false;
  return consent?.analytics === true;
}
