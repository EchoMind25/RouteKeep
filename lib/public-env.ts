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
  /** Production build: the service worker is registered only then, so development never serves stale code. */
  production: process.env.NODE_ENV === "production",
};
