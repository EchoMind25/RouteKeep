import { CheckCircle, CreditCard, DownloadSimple, Eye, FileText, Key, LockKey, Path, SignOut, Wall } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Cta, SecondaryCta } from "@/components/marketing/cta";
import { breadcrumb, JsonLd } from "@/components/marketing/json-ld";
import { BRAND } from "@/lib/brand";
import { SITE_PAGES, pageMetadata } from "@/lib/landing/pages";
import { SUBPROCESSORS } from "@/lib/legal/subprocessors";
import { publicEnv } from "@/lib/public-env";

// FR-WEB-01: how customer data is kept, in plain words. Every line here is
// something the code does today (CR-10, CR-12, CR-13, CR-15, D-09, NFR-08,
// OPS-01/02). No certifications, no uptime numbers: nothing we cannot show.
// The subprocessor list is the same one /subprocessors renders.

const PAGE = SITE_PAGES.security;
export const metadata = pageMetadata(PAGE);

const link = "font-semibold text-accent underline underline-offset-4 hover:text-accent-hover";

const OWNERSHIP = [
  "Your customer list, records and invoices belong to your business. We hold them to run the app for you.",
  "We don't sell your data, we don't use it for advertising, and there are no ad trackers or third-party analytics scripts. You decide whether we may learn anything from how you use the app.",
  "Owners and admins can export everything, any time, at no charge.",
];

const WALLS = [
  "Every table in the database has row level security turned on. Each row carries the business it belongs to, and the database itself refuses to show or change rows from any other business.",
  "The app reaches the database only through those same rules, so a bug in a screen cannot read past them.",
  "Automated tests set up two businesses and check, table by table, that one cannot see, change or add anything in the other.",
];

const TEAM = [
  { role: "Owners and admins", what: "Manage the team, run imports, and export everything." },
  { role: "Office and dispatchers", what: "Use the office app for the day to day work. They cannot manage the team, run imports or export everything." },
  { role: "Technicians", what: "Work their stops in the tech app. They cannot publish or reorder routes, see imports or read the change history." },
  { role: "Your customers", what: "Sign in to the portal and see only their own visits, invoices and payments." },
];

const SIGN_IN = [
  "Your team signs in with a 6-digit code sent to their email. There is no password to reuse or leak.",
  "Owners and admins also sign in with a code from an authenticator app on their phone.",
  "Your customers get a portal sign-in link by email. It is random, works once, and expires after 20 minutes.",
  "Every connection uses HTTPS, and the site tells browsers to always use it.",
];

const AI_SEES = [
  "Stop numbers (S1, S2 and so on), not customer names",
  "Service type, time on site and arrival window",
  "Rough positions in kilometres from your office, not street addresses or map coordinates",
  "Access notes, with phone numbers, email addresses and number codes taken out",
];

const DOCUMENTS = [
  { href: "/privacy", label: "Privacy Policy", note: "What we collect and why." },
  { href: "/dpa", label: "Data Processing Addendum", note: "Our commitments as the processor of your customers' data." },
  { href: "/subprocessors", label: "Subprocessors", note: "Every outside service and exactly what it receives." },
  { href: "/terms", label: "Terms of Service", note: "The agreement, including backups and cancellation." },
  { href: "/status", label: "Status page", note: "Current health of the service." },
];

export default function SecurityPage() {
  const email = publicEnv.salesEmail;
  return (
    <>
      <JsonLd data={breadcrumb(PAGE.label, PAGE.path)} />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 pt-16 pb-12 sm:px-6">
        <p className="text-sm font-semibold tracking-[0.14em] text-accent uppercase">Security and privacy</p>
        <h1 className="max-w-[22ch] text-4xl font-semibold tracking-tight text-balance md:text-5xl">Security and privacy for your customer list.</h1>
        <p className="max-w-[60ch] text-lg text-fg-muted">
          Your customer list is the business. Here is how {BRAND.name} keeps it separate from every other business, who can see it, where card numbers go, and how you take all of it with you.
        </p>
      </section>

      <section aria-labelledby="yours-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="yours-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Your data is yours.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">You and your team see your customers. We don&apos;t sell them or share them.</p>
          </div>
          <ul className="grid gap-4">
            {OWNERSHIP.map((item) => (
              <li key={item} className="flex gap-3 text-md">
                <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="walls-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <Wall size={32} className="text-accent" aria-hidden />
            <h2 id="walls-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Each business is walled off.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">Separation is enforced by the database, not just by the screens on top of it.</p>
          </div>
          <ul className="grid gap-4">
            {WALLS.map((item) => (
              <li key={item} className="flex gap-3 text-md">
                <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="who-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6">
          <div className="grid content-start gap-4">
            <Eye size={32} className="text-accent" aria-hidden />
            <h2 id="who-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Who can see what.
            </h2>
          </div>

          <div className="grid gap-10 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <h3 className="text-xl font-semibold">Your team, by role</h3>
              <dl className="grid divide-y divide-line border-y border-line">
                {TEAM.map((t) => (
                  <div key={t.role} className="grid gap-1 py-4">
                    <dt className="text-md font-semibold">{t.role}</dt>
                    <dd className="text-md text-fg-muted">{t.what}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-md text-fg-muted">
                Changes to your team, plans, spray records, agreements, invoices and payments are written to a change history that nobody can edit or delete.
              </p>
            </div>

            <div className="grid content-start gap-4">
              <h3 className="text-xl font-semibold">The people who run {BRAND.name}</h3>
              <p className="text-md">
                Our own console shows each business&apos;s size against its plan and the health of the system: email queues, payments, imports and errors. It cannot read your customers&apos; names,
                contact details or message content. That limit is set in the database, not only in the console.
              </p>
              <p className="text-md text-fg-muted">
                Signing in to it takes a second step from an authenticator app, and every action taken there is recorded in a log that can only be added to.
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            <h3 className="text-xl font-semibold">Outside services, and what each one gets</h3>
            <p className="max-w-[68ch] text-md text-fg-muted">
              A few services help run the app. Each receives only what it needs. The full list, with where each one runs, is on our{" "}
              <Link href="/subprocessors" className={link}>
                subprocessors page
              </Link>
              , and we post changes there at least 30 days before a new one receives customer data.
            </p>
            <dl className="grid divide-y divide-line border-y border-line">
              {SUBPROCESSORS.map((s) => (
                <div key={s.name} className="grid gap-1 py-4 sm:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] sm:gap-6">
                  <dt className="text-md font-semibold">
                    {s.name} <span className="font-normal text-fg-muted">({s.purpose})</span>
                  </dt>
                  <dd className="text-md text-fg-muted">
                    {s.data}. <span className="whitespace-nowrap">{s.when}.</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="payments-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <CreditCard size={32} className="text-accent" aria-hidden />
            <h2 id="payments-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Payments.
            </h2>
          </div>
          <ul className="grid gap-4">
            <li className="flex gap-3 text-md">
              <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>Card and bank numbers only ever go into Stripe&apos;s own secure pages, never through us.</span>
            </li>
            <li className="flex gap-3 text-md">
              <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>Payments go straight to your own Stripe account. We add no fee on top of your customers&apos; payments.</span>
            </li>
            <li className="flex gap-3 text-md">
              <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>An invoice is marked paid only from Stripe&apos;s signed notice that the money came through.</span>
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="signin-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <Key size={32} className="text-accent" aria-hidden />
            <h2 id="signin-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Sign-in.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">No passwords to forget, and a second step for the accounts that can do the most.</p>
          </div>
          <ul className="grid gap-4">
            {SIGN_IN.map((item) => (
              <li key={item} className="flex gap-3 text-md">
                <LockKey size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="ai-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <Path size={32} className="text-accent" aria-hidden />
            <h2 id="ai-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              AI with less data.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">
              The AI route plan reads notes like &quot;dog out until noon&quot; to order a day&apos;s stops. It only runs when someone asks for it, and you still see a preview and decide.
            </p>
          </div>
          <div className="grid content-start gap-4">
            <h3 className="text-xl font-semibold">What the AI sees</h3>
            <ul className="grid gap-3">
              {AI_SEES.map((item) => (
                <li key={item} className="flex gap-3 text-md">
                  <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-md text-fg-muted">Customer names, street addresses and phone numbers are never sent to it.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="leave-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <SignOut size={32} className="text-accent" aria-hidden />
            <h2 id="leave-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              If you leave.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">Being able to leave is part of the deal from day one.</p>
          </div>
          <ul className="grid gap-4">
            <li className="flex gap-3 text-md">
              <DownloadSimple size={20} weight="bold" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>
                One export file holds every table as CSV and JSON, your customer list ready to import anywhere, your pesticide application records as a PDF per month, and all photos, signatures and
                documents.
              </span>
            </li>
            <li className="flex gap-3 text-md">
              <DownloadSimple size={20} weight="bold" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>Cancel any month. After you cancel, you have 30 days to export. Then we delete your data, except what the law requires us to keep.</span>
            </li>
            <li className="flex gap-3 text-md">
              <DownloadSimple size={20} weight="bold" className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>We keep daily backups once your account holds real customer records.</span>
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="docs-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <FileText size={32} className="text-accent" aria-hidden />
            <h2 id="docs-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Documents.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">The written commitments behind this page.</p>
          </div>
          <ul className="grid divide-y divide-line border-y border-line">
            {DOCUMENTS.map((d) => (
              <li key={d.href} className="grid gap-1 py-4">
                <Link href={d.href} className={`text-lg ${link}`}>
                  {d.label}
                </Link>
                <span className="text-md text-fg-muted">{d.note}</span>
              </li>
            ))}
          </ul>
        </div>
        {email ? (
          <p className="mt-12 rounded-panel border border-line bg-sunken p-6 text-md">
            <span className="font-semibold">Report a security issue:</span> email{" "}
            <a href={`mailto:${email}?subject=${encodeURIComponent(`Security issue in ${BRAND.name}`)}`} className={link}>
              {email}
            </a>
            .
          </p>
        ) : null}
      </section>

      <section aria-labelledby="close-title" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-3">
            <h2 id="close-title" className="max-w-[20ch] text-4xl font-semibold tracking-tight text-balance">
              Bring your customer list over.
            </h2>
            <p className="max-w-[52ch] text-lg text-fg-muted">
              Start from your own export, check every row, and undo for 7 days.{" "}
              <Link href={SITE_PAGES.switch.path} className={link}>
                See how switching works
              </Link>{" "}
              or{" "}
              <Link href={SITE_PAGES.pricing.path} className={link}>
                see the pricing
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SecondaryCta href="/#faq">Read the FAQ</SecondaryCta>
            <Cta />
          </div>
        </div>
      </section>
    </>
  );
}
