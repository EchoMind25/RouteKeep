import { CheckCircle, Clock } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Cta, SecondaryCta } from "@/components/marketing/cta";
import { breadcrumb, JsonLd } from "@/components/marketing/json-ld";
import { BRAND } from "@/lib/brand";
import { formatCents } from "@/lib/domain/money";
import { PLANS, WHITE_LABEL } from "@/lib/landing/content";
import { pageMetadata, salesHref, SITE_PAGES } from "@/lib/landing/pages";

// FR-WEB-01: posted pricing (D-11, D-14) on its own page, so "pest control
// software pricing" has a page that answers it. Every line is something built
// today; the "not yet" list says plainly what is not.

const PAGE = SITE_PAGES.pricing;
export const metadata = pageMetadata(PAGE);

const CAPS = { Starter: 300, Pro: 1500, Growth: 5000 } as const;

const INCLUDED = [
  "Unlimited office users and technicians",
  "Recurring service plans, scheduling and a dispatch board with a map",
  "Route optimization with a preview, the minutes saved, and undo",
  "An AI route plan that reads access notes like \"dog out until noon\"",
  "The offline technician app, installable on iPhone and Android",
  "Pesticide application records with every Utah field, checked before a stop closes",
  "Service record PDFs with your business name and license",
  "Invoices with your logo, card and bank payments and autopay through your own Stripe account",
  "A customer portal where customers pay and see their history, with no password to forget",
  "Email reminders, on the way notices and service complete notices",
  "Technician sales with commission you set and approve",
  "Customer list import from CSV or Excel, with 7 days to undo",
  "Full export of everything, any time, at no charge",
  "Product usage reports by date, product, EPA number and tech",
];

const NOT_YET = [
  { what: "Text message reminders", note: "Next up. They need your own carrier registration first, and that cost passes through at what the carrier charges." },
  { what: "QuickBooks sync", note: "Planned. Until then, export invoices and payments as CSV." },
  { what: "App Store and Google Play apps", note: "The tech app installs from the browser to the home screen and works offline today." },
];

const PRICING_FAQ = [
  {
    q: "What counts as an active customer?",
    a: "Any customer on file marked active. Mark a customer inactive when they cancel and they stay on file with their full history, but they no longer count toward your plan.",
  },
  {
    q: "What happens if I grow past my plan's limit?",
    a: "Nothing in the app stops or locks. Your plan moves up to the next one from the following month.",
  },
  {
    q: "Is there a contract or a setup fee?",
    a: "No to both. Plans are month to month. Cancel any month and you won't be billed again. We give at least 30 days' notice of any price change.",
  },
  {
    q: "Do you charge per user or per text?",
    a: "No. Every plan has unlimited users. Email is included. When text reminders arrive, the carrier's cost passes through with no markup.",
  },
  {
    q: "What about card processing fees?",
    a: "Payments go to your own Stripe account. Stripe sets its processing price and you pay Stripe directly. We add no fee on top of your customers' payments.",
  },
];

function perCustomer(cents: number, cap: number): string {
  return `${(cents / cap).toFixed(0)}¢`;
}

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumb(PAGE.label, PAGE.path),
          { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PRICING_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
        ]}
      />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 pt-16 pb-12 sm:px-6">
        <p className="text-sm font-semibold tracking-[0.14em] text-accent uppercase">Pricing</p>
        <h1 className="max-w-[20ch] text-4xl font-semibold tracking-tight text-balance md:text-5xl">Pest control software pricing, posted.</h1>
        <p className="max-w-[56ch] text-lg text-fg-muted">
          Priced by how many active customers you have, never by seats. Every plan has every feature. Month to month, no setup fee, no contract.
        </p>
      </section>

      <section aria-labelledby="plans-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <h2 id="plans-title" className="sr-only">
          Plans
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const featured = "featured" in p && p.featured;
            return (
              <li key={p.name} className={`grid content-start gap-6 rounded-panel border p-8 ${featured ? "border-accent bg-surface shadow-overlay" : "border-line bg-surface"}`}>
                <div className="grid gap-1">
                  <h3 className="flex items-center gap-2 text-xl font-semibold">
                    {p.name}
                    {featured ? <span className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">Most shops</span> : null}
                  </h3>
                  <p className="text-md text-fg-muted">{p.note}</p>
                </div>
                <p className="flex items-baseline gap-1">
                  <span className="text-5xl font-semibold tracking-tight tabular">{formatCents(p.cents).replace(".00", "")}</span>
                  <span className="text-md text-fg-muted">a month</span>
                </p>
                <ul className="grid gap-2 text-md">
                  <li className="flex items-center gap-2 font-medium">
                    <CheckCircle size={18} className="shrink-0 text-success" aria-hidden /> {p.limit}
                  </li>
                  <li className="flex items-center gap-2 text-fg-muted">
                    <CheckCircle size={18} className="shrink-0 text-success" aria-hidden /> Unlimited users
                  </li>
                  <li className="flex items-center gap-2 text-fg-muted">
                    <CheckCircle size={18} className="shrink-0 text-success" aria-hidden /> About {perCustomer(p.cents, CAPS[p.name])} per customer when full
                  </li>
                </ul>
                <Cta className={featured ? "w-full" : "w-full border border-line-strong bg-transparent text-fg hover:bg-canvas"} />
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="included-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="included-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Included on every plan.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">The plans differ only in how many active customers they hold. A two-truck shop gets the same software as a ten-truck shop.</p>
          </div>
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-3 text-md">
                <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="not-yet-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="not-yet-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Not in it yet.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">So you can decide with the whole picture.</p>
          </div>
          <dl className="grid divide-y divide-line border-y border-line">
            {NOT_YET.map((n) => (
              <div key={n.what} className="grid gap-1 py-5 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] sm:gap-6">
                <dt className="flex items-center gap-2 text-lg font-semibold">
                  <Clock size={20} className="shrink-0 text-fg-muted" aria-hidden /> {n.what}
                </dt>
                <dd className="text-md text-fg-muted">{n.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="wl-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-6 rounded-panel border border-line bg-sunken p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-12">
          <div className="grid gap-3">
            <h2 id="wl-title" className="text-2xl font-semibold tracking-tight md:text-3xl">
              White label: {formatCents(WHITE_LABEL.cents).replace(".00", "")} one time
            </h2>
            <p className="max-w-[60ch] text-md text-fg-muted">
              Your brand on the office app, the tech app, the portal and every document, with ours taken off. Set up with you, your customer list brought over, and a year of support. Then your regular plan. Support after the first year is {formatCents(WHITE_LABEL.renewalCents).replace(".00", "")} a year if you want it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SecondaryCta href="/#white-label">What&apos;s included</SecondaryCta>
            <SecondaryCta href={salesHref(`White label ${BRAND.name}`)}>Ask about it</SecondaryCta>
          </div>
        </div>
      </section>

      <section aria-labelledby="pricing-faq-title" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <h2 id="pricing-faq-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Pricing questions.
          </h2>
          <dl className="grid divide-y divide-line border-y border-line">
            {PRICING_FAQ.map((f) => (
              <div key={f.q} className="grid gap-2 py-5">
                <dt className="text-lg font-semibold">{f.q}</dt>
                <dd className="max-w-[68ch] text-md text-fg-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="close-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-3">
            <h2 id="close-title" className="max-w-[20ch] text-4xl font-semibold tracking-tight text-balance">
              Moving from other software?
            </h2>
            <p className="max-w-[52ch] text-lg text-fg-muted">
              Bring your customer list from your own export. <Link href={SITE_PAGES.switch.path} className="font-semibold text-accent underline underline-offset-4 hover:text-accent-hover">See how switching works</Link>.
            </p>
          </div>
          <Cta />
        </div>
      </section>
    </>
  );
}
