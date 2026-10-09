import { ArrowsLeftRight, CellSignalSlash, CheckCircle, DeviceMobile, DownloadSimple, FilePdf, HandCoins, LockKey, Ruler, SealCheck } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HeroStage } from "@/components/landing/hero-stage";
import s from "@/components/landing/landing.module.css";
import { RouteScene } from "@/components/landing/route-scene";
import { Cta, SecondaryCta } from "@/components/marketing/cta";
import { JsonLd, organization, website } from "@/components/marketing/json-ld";
import { BRAND } from "@/lib/brand";
import { formatCents } from "@/lib/domain/money";
import { FAQS, PLANS, WHITE_LABEL } from "@/lib/landing/content";
import { salesHref, SITE_PAGES } from "@/lib/landing/pages";
import { publicEnv } from "@/lib/public-env";

// The public landing page. Static and indexable, with its guides beside it in
// app/(marketing) (lib/landing/pages.ts). Signed-in people go to /app.

const TITLE = `Pest Control Software That Works Offline | ${BRAND.name}`;
const DESCRIPTION =
  "Pest control and lawn care software for 1 to 10 truck companies. Route optimization, scheduling, an offline technician app and Utah-ready spray records. From $79 a month, no contract.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
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
      "@id": `${url}/#software`,
      name: BRAND.name,
      url,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Pest control and lawn care software",
      operatingSystem: "Web browser; installable app for iPhone and Android",
      description: DESCRIPTION,
      publisher: { "@id": `${url}/#organization` },
      featureList: [
        "Scheduling and recurring service plans",
        "Route optimization with preview and undo",
        "Offline technician app",
        "Pesticide application records with every Utah field",
        "Service record PDFs with your business license",
        "Product usage reports with CSV and PDF export",
        "Technician sales with commission tracking",
        "Customer list import from CSV or Excel, with 7 days to undo",
        "Full data export in one file: CSV, JSON, record PDFs and photos",
        "Invoicing, card and bank payments and autopay through your own Stripe account",
        "Customer portal with passwordless sign-in",
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
    organization(),
    website(),
  ];
}

export default function LandingPage() {
  return (
    <>
      <JsonLd data={jsonLd()} />

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
              <SecondaryCta href={SITE_PAGES.pricing.path}>See pricing</SecondaryCta>
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
              <p>
                <Link href={SITE_PAGES.utahRecords.path} className="text-md font-semibold text-accent underline underline-offset-4 hover:text-accent-hover">
                  Read the plain guide to Utah&apos;s record rule
                </Link>
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
                Posted prices. By customers, not seats.
              </h2>
              <p className="text-lg text-fg-muted">Priced by active customers, not seats. Unlimited users. Your logo on every invoice. Month to month, no setup fee.</p>
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
            <p className="pt-10 text-md text-fg-muted">
              Every plan has every feature.{" "}
              <Link href={SITE_PAGES.pricing.path} className="font-semibold text-accent underline underline-offset-4 hover:text-accent-hover">
                Compare plans and see what counts as an active customer
              </Link>
            </p>
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
                Every plan puts your logo on invoices. White label goes all the way: your logo, your colors, your web address on everything, set up around how you run your shop. Your customers never see ours.
              </p>
              <p className="flex items-baseline gap-2">
                <span className="text-5xl font-semibold tracking-tight tabular">{formatCents(WHITE_LABEL.cents).replace(".00", "")}</span>
                <span className="text-lg text-fg-muted">one time</span>
              </p>
              <p className="text-md text-fg-muted">
                Then your regular monthly plan. After the first year, support is {formatCents(WHITE_LABEL.renewalCents).replace(".00", "")} a year if you want to keep it. We build it so you shouldn&apos;t need much.
              </p>
              <div>
                <a href={salesHref(`White label ${BRAND.name}`)} className="inline-flex h-12 items-center rounded-control border border-line-strong px-6 text-md font-semibold whitespace-nowrap hover:bg-surface">
                  Ask about white label
                </a>
              </div>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2" aria-label="Included with white label">
              {WHITE_LABEL.includes.map((item, i) => (
                <li key={item} className={`flex gap-3 p-6 text-md ${i === WHITE_LABEL.includes.length - 1 ? `bg-accent-soft ${WHITE_LABEL.includes.length % 2 ? "sm:col-span-2" : ""}` : "bg-surface"}`}>
                  <CheckCircle size={22} weight="fill" className="shrink-0 text-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Leaving and staying: switching in, and the data that is always theirs */}
        <section aria-labelledby="yours-title" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          <h2 id="yours-title" className="pb-8 text-3xl font-semibold tracking-tight md:text-4xl">
            Easy to move in. Easy to leave.
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="grid content-start gap-3 rounded-panel border border-line bg-surface p-7">
              <ArrowsLeftRight size={28} className="text-accent" aria-hidden />
              <h3 className="text-xl font-semibold tracking-tight">Switch with a file, not a favor.</h3>
              <p className="text-md text-fg-muted">Export your list from the software you use now. Check every row before anything is added, and undo the whole import for 7 days.</p>
              <Link href={SITE_PAGES.switch.path} className="pt-1 text-md font-semibold text-accent underline underline-offset-4 hover:text-accent-hover">
                How switching works
              </Link>
            </article>
            <article className="grid content-start gap-3 rounded-panel border border-line bg-surface p-7">
              <DownloadSimple size={28} className="text-accent" aria-hidden />
              <h3 className="text-xl font-semibold tracking-tight">Take everything, any day.</h3>
              <p className="text-md text-fg-muted">One file with every table as CSV and JSON, every spray record as a PDF, and every photo and signature. No fee, no ticket, no waiting on us.</p>
            </article>
            <article className="grid content-start gap-3 rounded-panel border border-line bg-surface p-7">
              <LockKey size={28} className="text-accent" aria-hidden />
              <h3 className="text-xl font-semibold tracking-tight">Your list stays yours.</h3>
              <p className="text-md text-fg-muted">Each business is walled off in the database itself. Owners sign in with a second step. Card numbers only ever go into Stripe.</p>
              <Link href={SITE_PAGES.security.path} className="pt-1 text-md font-semibold text-accent underline underline-offset-4 hover:text-accent-hover">
                Security and privacy
              </Link>
            </article>
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
    </>
  );
}
