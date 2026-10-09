import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { publicEnv } from "@/lib/public-env";

// Every public marketing page in one list, so the header, footer, sitemap and
// /llms.txt always agree on what exists (FR-WEB-01). `updated` is the date the
// page's content last changed; bump it with the copy so the sitemap tells
// search engines the truth.

export interface SitePage {
  path: string;
  /** Short name for menus. */
  label: string;
  /** The <title>, without the brand suffix. Lead with the words people search for. */
  title: string;
  description: string;
  updated: string;
}

export const SITE_PAGES = {
  pricing: {
    path: "/pricing",
    label: "Pricing",
    title: "Pest Control Software Pricing, Posted",
    description: `${BRAND.name} costs $79, $179 or $349 a month by active customers. Unlimited users, no contract, no setup fee. See what every plan includes and what it costs per customer.`,
    updated: "2026-10-09",
  },
  switch: {
    path: "/switch",
    label: "Switching",
    title: "Switch Pest Control Software Without Losing a Customer",
    description: `Moving from FieldRoutes, PestPac, GorillaDesk, Jobber or a spreadsheet? Bring your customer list over from your own export, check every row, undo for 7 days, and go live when you are ready.`,
    updated: "2026-10-09",
  },
  utahRecords: {
    path: "/utah-pesticide-records",
    label: "Utah spray records",
    title: "Utah Pesticide Application Records: What to Keep",
    description: "A plain guide to the records Utah's rule R68-7 asks commercial pesticide applicators to keep: every field, the 24 hour deadline, restricted use statements and how long to keep them.",
    updated: "2026-10-09",
  },
  security: {
    path: "/security",
    label: "Security and privacy",
    title: "Security and Privacy for Your Customer List",
    description: `How ${BRAND.name} keeps each business's data separate, who can see it, where card numbers go, and how to take every record with you in one file.`,
    updated: "2026-10-09",
  },
} as const satisfies Record<string, SitePage>;

/** The landing page's own content date, for the sitemap. */
export const HOME_UPDATED = "2026-10-09";

/** A mailto link to sales, or sign-in when no sales address is configured. */
export function salesHref(subject: string): string {
  return publicEnv.salesEmail ? `mailto:${publicEnv.salesEmail}?subject=${encodeURIComponent(subject)}` : "/sign-in";
}

/** Metadata for a public marketing page: indexable, canonical, with its social card text. */
export function pageMetadata(page: SitePage): Metadata {
  const title = `${page.title} | ${BRAND.name}`;
  return {
    title: { absolute: title },
    description: page.description,
    alternates: { canonical: page.path },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: page.path, siteName: BRAND.name, title, description: page.description },
    twitter: { card: "summary_large_image", title, description: page.description },
  };
}
