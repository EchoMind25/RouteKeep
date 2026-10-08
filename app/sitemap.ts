import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/public-env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${publicEnv.siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    ...["terms", "privacy", "dpa", "subprocessors"].map((p) => ({ url: `${publicEnv.siteUrl}/${p}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
