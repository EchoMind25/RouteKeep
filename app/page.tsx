import { ArrowRight, CellSignalSlash, CheckCircle, DeviceMobile, FilePdf, HandCoins, Ruler, SealCheck } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { HeroStage } from "@/components/landing/hero-stage";
import s from "@/components/landing/landing.module.css";
import { RouteScene } from "@/components/landing/route-scene";
import { BRAND } from "@/lib/brand";
import { formatCents } from "@/lib/domain/money";
import { FAQS, PLANS, WHITE_LABEL } from "@/lib/landing/content";
import { publicEnv } from "@/lib/public-env";

// The public landing page. Static, indexable, and the only page search engines
// are invited to read (app/robots.ts). Signed-in people go to /app.

const TITLE = `Pest Control Software That Works Offline | ${BRAND.name}`;
const DESCRIPTION =
  "Pest control and lawn care software for 1 to 10 truck companies. Route optimization, scheduling, an offline technician app and Utah-ready spray records. From $79 a month, no contract.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  metadataBase: new URL(publicEnv.siteUrl),
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: "/", siteName: BRAND.name, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const STEPS = [
  { title: "Plan it", body: "Every tech's route next to the map. Stop 4 is stop 4 on the map, the list and the phone. No guessing which one." },
  { title: "Optimize it", body: "Hit optimize and see the new order and the minutes saved before anything changes. Keep it or undo it. Arrival windows stay put." },
  { title: "Catch bad pins", body: "A stop that's suddenly a long drive away gets flagged before you publish. Usually it's a pin in the wrong spot. Fix it in seconds." },
  { title: "Send it", body: "Publish and the route lands on every tech's phone, ready for a day with no signal." },
];

const RECORD_FIELDS = ["EPA number", "Mix rate", "Total applied", "Area treated", "Target pests", "Applicator license", "Restricted use statement"];

function jsonLd() {
  const url = publicEnv.siteUrl;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: BRAND.name,
      url,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Pest control and lawn care software",
      operatingSystem: "Web browser; installable app for iPhone and Android",
      description: DESCRIPTION,
      featureList: [
        "Scheduling and recurring service plans",
        "Route optimization with preview and undo",
        "Offline technician app",
        "Pesticide application records with every Utah field",
        "Service record PDFs with your business license",
        "Product usage reports with CSV and PDF export",
        "Technician sales with commission tracking",
      ],
      offers: [
        ...PLANS.map((p) => ({
          "@type": "Offer",
          name: `${p.name} plan`,
          description: p.limit,
          price: (p.cents / 100).toFixed(2),
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", price: (p.cents / 100).toFixed(2), priceCurrency: "USD", billingDuration: "P1M", unitText: "month" },
        })),
        {
          "@type": "Offer",
          name: "White label setup",
          description: "Your brand on the office app, technician app, PDFs and statements; setup with the owner; one year of fix-it support. One time.",
          price: (WHITE_LABEL.cents / 100).toFixed(2),
          priceCurrency: "USD",
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
}

function Cta({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/sign-in"
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-control bg-accent px-6 text-md font-semibold whitespace-nowrap text-on-accent transition-transform hover:bg-accent-hover active:scale-[0.98] ${className}`}
    >
      Get started <ArrowRight size={18} weight="bold" aria-hidden />
    </Link>
  );
}

export default function LandingPage() {
  const whiteLabelHref = publicEnv.salesEmail ? `mailto:${publicEnv.salesEmail}?subject=${encodeURIComponent(`White label ${BRAND.name}`)}` : "/sign-in";
  return (
    <div className="bg-canvas text-fg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()).replace(/</g, "\\u003c") }} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
          <Link href="/" aria-label={`${BRAND.name} home`}>
            <BrandMark />
          </Link>
          <ul className="hidden items-center gap-7 text-md font-medium text-fg-muted md:flex">
            <li><a href="#how" className="hover:text-fg">How it works</a></li>
            <li><a href="#pricing" className="hover:text-fg">Pricing</a></li>
            <li><a href="#white-label" className="hover:text-fg">White label</a></li>
            <li><a href="#faq" className="hover:text-fg">FAQ</a></li>
          </ul>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-md font-medium whitespace-nowrap text-fg-muted hover:text-fg">
              Sign in
            </Link>
            <span className="hidden sm:block">
              <Cta className="h-10 px-4" />
            </span>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 overflow-x-clip px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:pt-10">
          <div className="grid gap-6">
            <p className="text-sm font-semibold tracking-[0.14em] text-accent uppercase">For pest and lawn companies, 1 to 10 trucks</p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance">Pest control software that works offline.</h1>
            <p className="max-w-[44ch] text-lg text-fg-muted">
              Routes, scheduling, spray records that hold up, and a tech app that keeps going in a dead zone. Month to month.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Cta />
              <a href="#pricing" className="inline-flex h-12 items-center rounded-control border border-line-strong px-6 text-md font-semibold whitespace-nowrap hover:bg-surface">
                See pricing
              </a>
            </div>
          </div>
          <HeroStage />
        </section>

        {/* The deal, in plain words */}
        <section aria-labelledby="deal" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 md:py-28">
            <h2 id="deal" className="sr-only">
              What you get, and what you don&apos;t
            </h2>
            <p className="text-2xl leading-snug font-medium tracking-tight text-balance sm:text-3xl md:text-4xl md:leading-tight">
              No contract. No setup fee. No paying per user, so seasonal help costs nothing.{" "}
              <span className="text-fg-muted">Your customer list stays yours.</span> And the app keeps working when the signal{" "}
              <span className="text-accent">doesn&apos;t.</span>
            </p>
          </div>
        </section>

        {/* The day, in 3D */}
        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="grid max-w-[60ch] gap-3 pb-6">
            <h2 id="how-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Route optimization you can actually see.
            </h2>
            <p className="text-lg text-fg-muted">Drag stops between techs, optimize, and know the drive time saved before you commit.</p>
          </div>
          <RouteScene steps={STEPS} />
        </section>

        {/* Offline, as a bento */}
        <section aria-labelledby="offline-title" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          <h2 id="offline-title" className="pb-8 text-3xl font-semibold tracking-tight md:text-4xl">
            Zero bars. Still working.
          </h2>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-2">
            <article className={`${s.tiltParent} relative grid overflow-hidden rounded-panel border border-line bg-sunken md:row-span-2 md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]`}>
              <div className="grid content-start gap-3 p-7 md:p-9">
                <DeviceMobile size={28} className="text-accent" aria-hidden />
                <h3 className="text-2xl font-semibold tracking-tight">Every tap saved on the phone first.</h3>
                <p className="text-md text-fg-muted">
                  Products, mix rates, photos, the customer&apos;s signature. It all lives on the device and uploads by itself when the signal comes back. Once. No duplicates.
                </p>
              </div>
              <div className="flex items-end justify-center px-6 pt-2 md:pt-12" style={{ perspective: "1400px" }}>
                <picture className={`${s.tilt} -mb-24 block w-[min(260px,70%)] overflow-hidden rounded-[30px] border-[7px] border-fg shadow-overlay`}>
                  <source srcSet="/landing/product-dark.webp" media="(prefers-color-scheme: dark)" />
                  <Image
                    src="/landing/product-light.webp"
                    alt="Entering a product in the technician app: mix rate, total applied and area treated, each with its unit"
                    width={600}
                    height={1298}
                    sizes="260px"
                    className="block h-auto w-full"
                  />
                </picture>
              </div>
            </article>
            <article className={`${s.settle} grid content-between gap-6 rounded-panel bg-accent p-7 text-on-accent md:p-9`}>
              <CellSignalSlash size={30} aria-hidden />
              <div className="grid gap-2">
                <h3 className="text-3xl font-semibold tracking-tight">Kill the app mid stop. Twice.</h3>
                <p className="text-md opacity-90">We do it on purpose in our tests. The stop comes back right where it was, numbers and all.</p>
              </div>
            </article>
            <article className={`${s.settle} grid content-between gap-6 rounded-panel border border-line bg-surface p-7 md:p-9`}>
              <Ruler size={30} className="text-accent" aria-hidden />
              <div className="grid gap-2">
                <h3 className="text-2xl font-semibold tracking-tight">Mix rates nobody misreads.</h3>
                <p className="text-md text-fg-muted">Every number has its unit beside it and a plain words preview, so 0.06 never turns into 6%.</p>
              </div>
            </article>
          </div>
        </section>

        {/* Records */}
        <section aria-labelledby="records-title" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-7xl items-center gap-14 overflow-x-clip px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="order-2 lg:order-1">
              <div className={`${s.sheet} mx-auto w-full max-w-[520px] overflow-hidden rounded-[4px] border border-line bg-canvas`}>
                <Image src="/landing/record.webp" alt="A service record PDF: business name and license at the top, then every product applied with its EPA number" width={900} height={776} sizes="(min-width: 1024px) 520px, 100vw" className="block h-auto w-full" />
              </div>
            </div>
            <div className="order-1 grid gap-5 lg:order-2">
              <h2 id="records-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
                Pesticide records that hold up.
              </h2>
              <p className="max-w-[52ch] text-lg text-fg-muted">
                Every field Utah&apos;s rule asks for, checked before a tech can close the stop. Records running late get flagged at 20 hours. Customers get a PDF with your business name and license on every page.
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="Fields on every record">
                {RECORD_FIELDS.map((f) => (
                  <li key={f} className="inline-flex items-center gap-1.5 rounded-pill border border-line px-3 py-1.5 text-sm font-medium">
                    <SealCheck size={15} className="text-success" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-2 text-md text-fg-muted">
                <FilePdf size={20} aria-hidden /> Product usage by date, product, EPA number and tech, as CSV or PDF.
              </p>
            </div>
          </div>
        </section>

        {/* Technician sales */}
        <section aria-labelledby="sales-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="grid gap-10 rounded-panel border border-line bg-sunken p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-12">
            <div className="grid gap-3">
              <HandCoins size={30} className="text-accent" aria-hidden />
              <h2 id="sales-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
                Your techs sell. They get paid for it.
              </h2>
              <p className="max-w-[50ch] text-lg text-fg-muted">
                Techs add the customer and plan right from their phone and see the commission before they save. You approve and pay it from the office.
              </p>
            </div>
            <figure className="grid gap-2 md:text-right">
              <p className="text-4xl font-semibold tracking-tight tabular md:text-5xl">$44.90</p>
              <figcaption className="text-md text-fg-muted">$25 flat + 10% of a $199 first service. Example rule, you set yours.</figcaption>
            </figure>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <div className="grid max-w-[60ch] gap-3 pb-12">
              <h2 id="pricing-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
                Pest control software pricing, posted.
              </h2>
              <p className="text-lg text-fg-muted">Priced by active customers, not seats. Unlimited users. Month to month, no setup fee.</p>
            </div>
            <ol className="grid items-end gap-4 md:grid-cols-[1fr_1.12fr_1fr]">
              {PLANS.map((p) => {
                const featured = "featured" in p && p.featured;
                return (
                  <li
                    key={p.name}
                    className={`grid gap-6 rounded-panel border p-8 ${featured ? "border-accent bg-canvas shadow-overlay md:-translate-y-4 md:py-12" : "border-line bg-canvas"}`}
                  >
                    <div className="grid gap-1">
                      <h3 className="text-xl font-semibold">{p.name}</h3>
                      <p className="text-md text-fg-muted">{p.note}</p>
                    </div>
                    <p className="flex items-baseline gap-1">
                      <span className="text-5xl font-semibold tracking-tight tabular">{formatCents(p.cents).replace(".00", "")}</span>
                      <span className="text-md text-fg-muted">a month</span>
                    </p>
                    <p className="flex items-center gap-2 text-md font-medium">
                      <CheckCircle size={18} className="text-success" aria-hidden /> {p.limit}
                    </p>
                    {featured ? <Cta className="w-full" /> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* White label */}
        <section id="white-label" aria-labelledby="wl-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="grid content-start gap-5">
              <h2 id="wl-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
                Want it under your own name?
              </h2>
              <p className="max-w-[46ch] text-lg text-fg-muted">
                We&apos;ll white label it for you. Your logo, your colors, your web address. Your customers never see ours.
              </p>
              <p className="flex items-baseline gap-2">
                <span className="text-5xl font-semibold tracking-tight tabular">{formatCents(WHITE_LABEL.cents).replace(".00", "")}</span>
                <span className="text-lg text-fg-muted">one time</span>
              </p>
              <p className="text-md text-fg-muted">Then your regular monthly plan. That&apos;s it.</p>
              <div>
                <a href={whiteLabelHref} className="inline-flex h-12 items-center rounded-control border border-line-strong px-6 text-md font-semibold whitespace-nowrap hover:bg-surface">
                  Ask about white label
                </a>
              </div>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2" aria-label="Included with white label">
              {WHITE_LABEL.includes.map((item, i) => (
                <li key={item} className={`flex gap-3 bg-surface p-6 text-md ${i === WHITE_LABEL.includes.length - 1 ? "sm:col-span-2 bg-accent-soft" : ""}`}>
                  <CheckCircle size={22} weight="fill" className="shrink-0 text-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <h2 id="faq-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Questions owners ask.
            </h2>
            <div className="divide-y divide-line border-y border-line">
              {FAQS.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-semibold">
                    <h3>{f.q}</h3>
                    <span className="grid size-8 shrink-0 place-items-center rounded-pill border border-line text-xl leading-none transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="max-w-[68ch] pt-3 text-md text-fg-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Close */}
        <section aria-labelledby="close-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <h2 id="close-title" className="max-w-[18ch] text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              Run tomorrow&apos;s route on it.
            </h2>
            <Cta />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-10 text-md text-fg-muted sm:px-6">
          <BrandMark />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-6">
              <li><a href="#pricing" className="hover:text-fg">Pricing</a></li>
              <li><a href="#white-label" className="hover:text-fg">White label</a></li>
              <li><a href="#faq" className="hover:text-fg">FAQ</a></li>
              <li><Link href="/sign-in" className="hover:text-fg">Sign in</Link></li>
            </ul>
          </nav>
          <p>
            &copy; {new Date().getFullYear()} {BRAND.name}. {BRAND.tagline}.
          </p>
        </div>
      </footer>
    </div>
  );
}
