import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

// The public marketing pages (FR-WEB-01): the landing page and its guides.
// Static and indexable; app/robots.ts keeps everything behind sign-in out.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
