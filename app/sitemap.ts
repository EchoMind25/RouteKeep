import type { MetadataRoute } from "next";
import { HOME_UPDATED, SITE_PAGES } from "@/lib/landing/pages";
import { publicEnv } from "@/lib/public-env";

// Every indexable page (FR-WEB-01). The legal pages are indexable too, so a
// buyer searching "<name> privacy" finds them; the status page is not listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const url = publicEnv.siteUrl;
  return [
    { url: `${url}/`, lastModified: HOME_UPDATED, changeFrequency: "weekly", priority: 1 },
    ...Object.values(SITE_PAGES).map((p) => ({ url: `${url}${p.path}`, lastModified: p.updated, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...["terms", "privacy", "dpa", "subprocessors"].map((p) => ({ url: `${url}/${p}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
