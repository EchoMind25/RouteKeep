import type { NextConfig } from "next";

// Host-portable on purpose (D-03): nothing here is Netlify-specific.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Technicians need the camera (photos) and location (navigate); nothing else.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Versions the technician app's offline copy: a deploy installs a new service
// worker and drops the old caches. Netlify and GitHub provide the commit.
const appVersion = (process.env.COMMIT_REF ?? process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 12);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
  poweredByHeader: false,
  // pg loads optional native bindings at runtime; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // Short ways into the app: /login and /app both end at sign-in or the right home.
  async redirects() {
    return [{ source: "/login", destination: "/app", permanent: false }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The worker must always be fetched fresh, or a deploy could not replace it.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/tech" }] },
    ];
  },
};

export default nextConfig;
