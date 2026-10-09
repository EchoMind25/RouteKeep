import { SITE_PAGES } from "@/lib/landing/pages";

// Which requests proxy.ts can treat lightly. Kept apart from proxy.ts so the
// patterns can be unit tested (lib/proxy-paths.test.ts).

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARKETING = Object.values(SITE_PAGES)
  .map((p) => escape(p.path.slice(1)))
  .join("|");
const LEGAL = "terms|privacy|dpa|subprocessors";

/**
 * Public and machine routes never read the session, so they skip the Supabase
 * refresh: the landing page and its guides (the busiest pages for visitors who
 * are not signed in), legal and status pages, webhooks, the portal, and the
 * search and social card files, including each guide's own card.
 */
export const NO_SESSION = new RegExp(
  `^/($|(${MARKETING}|${LEGAL}|status)$|api/(webhooks|cron|csp-report)(/|$)|p/|u/|robots\\.txt$|sitemap\\.xml$|llms\\.txt$|([\\w-]+/)*opengraph-image)`,
);

/**
 * Pages prerendered at build. They cannot carry a per-request nonce, so a
 * nonce policy only makes every visit post violation reports to
 * /api/csp-report (a function call each). They get no policy header until
 * they have a hash-based one of their own.
 */
export const STATIC_PUBLIC = new RegExp(`^/($|(${MARKETING}|${LEGAL})$)`);
