import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ErrorReporter } from "@/components/telemetry/error-reporter";

// Public pages beside the landing page: legal (CR-13) and status (NFR-04).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      {/* OPS-03: public site, error reports only (contract section 5). */}
      <ErrorReporter />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link href="/" aria-label="Home">
            <BrandMark />
          </Link>
          <Link href="/sign-in" className="font-medium text-fg-muted hover:text-fg">
            Sign in
          </Link>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="focus:outline-none mx-auto max-w-3xl px-4 py-12">
        {children}
      </main>
      <footer className="border-t border-line">
        <nav aria-label="Legal" className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-8 text-sm text-fg-muted">
          <Link href="/terms" className="hover:text-fg">Terms</Link>
          <Link href="/privacy" className="hover:text-fg">Privacy</Link>
          <Link href="/dpa" className="hover:text-fg">Data processing</Link>
          <Link href="/subprocessors" className="hover:text-fg">Subprocessors</Link>
          <Link href="/status" className="hover:text-fg">Status</Link>
        </nav>
      </footer>
    </div>
  );
}
