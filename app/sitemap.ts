import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/public-env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${publicEnv.siteUrl}/`, changeFrequency: "weekly", priority: 1 }];
}
