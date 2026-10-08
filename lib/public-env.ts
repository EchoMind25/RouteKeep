// Values that are safe in the browser. Next.js inlines NEXT_PUBLIC_* at build time.
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /**
   * MapLibre style for the basemap (D-08). Empty means no basemap: pins and
   * routes on a plain background, and no request leaves the browser for tiles.
   * Set an open-tile style (or a self-hosted PMTiles style) to show streets.
   */
  mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "",
  /** Set at build (next.config.ts); names the technician app's offline copy. */
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  /**
   * The public address of the site, for canonical links, the sitemap and
   * social cards. The Netlify address until the owner's domain is live.
   */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "https://spontaneous-naiad-6d1a16.netlify.app").replace(/\/$/, ""),
  /** Where "Ask about white label" goes. Owner decision 2026-10-07; override per deploy if it changes. */
  salesEmail: process.env.NEXT_PUBLIC_SALES_EMAIL || "RouteKeep@proton.me",
  /** CR-13: the legal entity named in Terms, Privacy and the DPA (OQ-02). Until set, the pages name the product. */
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME ?? "",
  /** Production build: the service worker is registered only then, so development never serves stale code. */
  production: process.env.NODE_ENV === "production",
};
