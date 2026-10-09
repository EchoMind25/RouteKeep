import { List, X } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { BRAND } from "@/lib/brand";
import { SITE_PAGES } from "@/lib/landing/pages";
import { Cta } from "./cta";
import { MobileMenu } from "./mobile-menu";

// The public pages' header (FR-WEB-01). Below the large breakpoint the links
// fold into a menu built on <details>, so it opens without any script
// (components/marketing/mobile-menu.tsx).

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: SITE_PAGES.pricing.path, label: SITE_PAGES.pricing.label },
  { href: SITE_PAGES.switch.path, label: SITE_PAGES.switch.label },
  { href: "/#white-label", label: "White label" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" aria-label={`${BRAND.name} home`}>
          <BrandMark />
        </Link>
        <ul className="hidden items-center gap-7 text-md font-medium text-fg-muted lg:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="hover:text-fg">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-md font-medium whitespace-nowrap text-fg-muted hover:text-fg">
            Sign in
          </Link>
          <span className="hidden sm:block">
            <Cta className="h-10 px-4" />
          </span>
          <MobileMenu className="group lg:hidden">
            <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-control border border-line text-fg hover:bg-surface [&::-webkit-details-marker]:hidden">
              <List size={22} className="group-open:hidden" aria-hidden />
              <X size={22} className="hidden group-open:block" aria-hidden />
              <span className="sr-only">Menu</span>
            </summary>
            <div className="absolute inset-x-0 top-16 border-b border-line bg-canvas px-4 pt-2 pb-6 shadow-overlay sm:px-6">
              <ul className="mx-auto grid max-w-7xl text-lg font-medium">
                {LINKS.map((l) => (
                  <li key={l.href} className="border-b border-line last:border-0">
                    <Link href={l.href} className="flex min-h-12 items-center hover:text-accent">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <Cta className="mt-4 w-full sm:hidden" />
            </div>
          </MobileMenu>
        </div>
      </nav>
    </header>
  );
}
