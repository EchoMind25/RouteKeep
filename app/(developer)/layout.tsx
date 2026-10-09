import { ShieldCheck, SignOut } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { authMode } from "@/lib/auth-mode";
import { requireDeveloper } from "@/lib/auth/session";
import { signOut } from "../(auth)/sign-in/actions";

export const metadata: Metadata = { title: "Developer console", robots: { index: false, follow: false } };

// OPS-01: the developer console sits outside every business's office app, so no
// tenant branding, navigation or membership applies here.
export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const dev = await requireDeveloper();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="rounded-pill bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">Developer</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm text-fg-muted" title={dev.email}>
              {dev.email}
            </span>
            {authMode() === "supabase" ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/account/mfa">
                  <ShieldCheck size={16} aria-hidden /> Two-step sign-in
                </Link>
              </Button>
            ) : null}
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                <SignOut size={16} aria-hidden /> Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="min-w-0 px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
