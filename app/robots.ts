import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/public-env";

// The public pages (landing, guides, legal) are for search engines and AI
// crawlers; the app behind sign-in is private and says so.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/llms.txt"],
        disallow: ["/app", "/api/", "/schedule", "/customers", "/settings", "/reports", "/setup", "/tech", "/sales", "/onboarding", "/sign-in", "/p/", "/u/"],
      },
    ],
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
    host: publicEnv.siteUrl,
  };
}
