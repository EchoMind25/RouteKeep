import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/auth-mode";
import { NO_SESSION, STATIC_PUBLIC } from "@/lib/proxy-paths";
import { publicEnv } from "@/lib/public-env";

// Three jobs, in order: send app./login. hosts into the app, tag the request
// (id for logs, NFR-06; nonce for the CSP, Next.js 16 content-security-policy
// guide), and keep Supabase sessions fresh for app routes only: an expired
// access token is refreshed here so Server Components (which cannot set
// cookies) always see a valid one. Authorization itself happens next to the
// data (lib/auth/session.ts, RLS).

// Which routes skip the session refresh and which carry no nonce policy:
// lib/proxy-paths.ts.

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Report-only while it is tuned against real traffic; flip the header name to
// Content-Security-Policy to enforce. Prerendered public pages carry no nonce,
// so they get no policy here (STATIC_PUBLIC); they need a hash-based one first.
function policy(nonce: string): string {
  const dev = !publicEnv.production; // React needs eval for debug stacks outside production
  const supabase = origin(publicEnv.supabaseUrl);
  const map = origin(publicEnv.mapStyleUrl);
  const stripe = "https://checkout.stripe.com https://connect.stripe.com";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${[supabase, map].filter(Boolean).join(" ")}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${[supabase, map, supabase.replace(/^http/, "ws")].filter(Boolean).join(" ")}`.trim(),
    "worker-src 'self' blob:",
    `frame-src ${stripe}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${stripe}`,
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  // app.<domain> and login.<domain> open straight into the app (sign-in when
  // signed out) instead of the landing page. Works once a custom domain is
  // connected; *.netlify.app addresses cannot have subdomains, so use /app.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const path = request.nextUrl.pathname;
  if (path === "/" && /^(app|login)\./.test(host)) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  const requestId = request.headers.get("x-nf-request-id") ?? crypto.randomUUID();
  const html = !path.startsWith("/api/") && !STATIC_PUBLIC.test(path);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = policy(nonce);
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    if (html) {
      headers.set("x-nonce", nonce);
      headers.set("Content-Security-Policy-Report-Only", csp);
    }
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("x-request-id", requestId);
    if (html) response.headers.set("Content-Security-Policy-Report-Only", csp);
    return response;
  };

  let response = next();
  if (NO_SESSION.test(path) || authMode() !== "supabase" || !publicEnv.supabaseUrl) return response;

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!api/inngest|_next/static|_next/image|vendor/|sw.js|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml|llms.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
