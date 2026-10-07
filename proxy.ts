import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/auth-mode";
import { publicEnv } from "@/lib/public-env";

// Keeps Supabase sessions fresh: an expired access token is refreshed here so
// Server Components (which cannot set cookies) always see a valid one.
// Authorization itself happens next to the data (lib/auth/session.ts, RLS).
export async function proxy(request: NextRequest) {
  if (authMode() !== "supabase" || !publicEnv.supabaseUrl) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!api/inngest|_next/static|_next/image|vendor/|sw.js|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
