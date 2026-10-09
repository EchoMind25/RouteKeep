import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { BRAND } from "@/lib/brand";
import { SITE_PAGES } from "@/lib/landing/pages";
import { publicEnv } from "@/lib/public-env";

// The public pages' footer (FR-WEB-01, FR-WEB-03): every marketing page, the
// legal pages and a way to reach a person.

const pages = Object.values(SITE_PAGES);
const linksFor = (group: (typeof pages)[number]["group"]) => pages.filter((p) => p.group === group).map((p) => ({ href: p.path, label: p.label }));

const GROUPS = [
  {
    title: "Product",
    links: [{ href: "/#how", label: "How it works" }, ...linksFor("product"), { href: "/#white-label", label: "White label" }, { href: "/#faq", label: "FAQ" }],
  },
  // A guide added to lib/landing/pages.ts shows up here by itself.
  { title: "Guides", links: linksFor("guides") },
  {
    title: "Company",
    links: [
      { href: "/sign-in", label: "Sign in", prefetch: false },
      { href: "/status", label: "Status" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/dpa", label: "Data processing" },
      { href: "/subprocessors", label: "Subprocessors" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 text-md sm:px-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-3">
          <BrandMark />
          <p className="max-w-[34ch] text-fg-muted">{BRAND.tagline}.</p>
          {publicEnv.salesEmail ? (
            <p className="text-fg-muted">
              Questions? <a href={`mailto:${publicEnv.salesEmail}`} className="font-medium text-fg underline underline-offset-4 hover:text-accent">{publicEnv.salesEmail}</a>
            </p>
          ) : null}
        </div>
        <nav aria-label="Footer" className="grid gap-10 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="grid content-start gap-3">
              <h2 className="text-sm font-semibold tracking-[0.08em] text-fg uppercase">{g.title}</h2>
              <ul className="grid gap-2 text-fg-muted">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} prefetch={"prefetch" in l ? l.prefetch : undefined} className="hover:text-fg">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-fg-muted sm:px-6">
          &copy; {new Date().getFullYear()} {publicEnv.legalName || BRAND.name}. Prices in US dollars.
        </p>
      </div>
    </footer>
  );
}
