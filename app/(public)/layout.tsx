import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

// Public pages beside the landing page: legal (CR-13) and status (NFR-04).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-fg">
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
      <main id="main" className="mx-auto max-w-3xl px-4 py-12">
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
