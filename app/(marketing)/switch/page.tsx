import { CheckCircle, Clock, FileArrowDown } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Cta, SecondaryCta } from "@/components/marketing/cta";
import { breadcrumb, JsonLd } from "@/components/marketing/json-ld";
import { BRAND } from "@/lib/brand";
import { pageMetadata, salesHref, SITE_PAGES } from "@/lib/landing/pages";

// FR-WEB-01, PRD section 9: how switching works, for people searching to move
// from other software. Every line is the import, go live and export flow as
// built today; "not yet" says plainly what does not come over.

const PAGE = SITE_PAGES.switch;
export const metadata = pageMetadata(PAGE);

const LINK = "font-semibold text-accent underline underline-offset-4 hover:text-accent-hover";
const ASK = salesHref(`Switching to ${BRAND.name}`);

const EXPORT_LIST = [
  "Customer name, or company name for commercial accounts",
  "Service address: street, city, state and ZIP",
  "Email and phone",
  "Service plan and how often you come",
  "Price per service, when it differs from the plan price",
  "Next service date and any open balance",
  "Gate codes, pets and other access notes",
];

const STEPS = [
  { title: "Upload your file", body: "A CSV or Excel .xlsx file exported from the software you use now, or your own spreadsheet. Nothing is added yet." },
  { title: "Match columns", body: "Each field takes its value from a column you pick, with examples from the first rows of your file. Common column names are matched for you." },
  { title: "Check every row", body: "Rows that cannot be imported are listed with the reason. Download them, fix them, and upload them again." },
  { title: "See what will happen", body: "A dry run shows new customers, updates, duplicates skipped, active plans, monthly plan revenue and open balances. Still nothing added." },
  { title: "Import and check the totals", body: "Press Import. Then see what your file said beside what is now in the app, so you know everything came over." },
  { title: "Undo for 7 days", body: "Changed your mind or used the wrong file? Undo the import. Customers you have already worked with are kept." },
];

const COMES_OVER = [
  "Customer names, company names and customer numbers",
  "Service addresses, placed on the map where they can be found",
  "Email addresses and two phone numbers",
  "Access notes and customer notes",
  "Service plan, price per service and next service date",
  "Open balances",
  "Active or inactive status",
];

const NOT_YET = [
  { what: "Technicians", note: "Invite each one from Settings. They sign in on their phone and install the tech app." },
  { what: "Products", note: "Add the products you apply with their EPA registration numbers. With white label, we set these up with you." },
  { what: "Past visits and application records", note: "Only the customer list is imported. Keep your old records from your previous software." },
  { what: "Documents and photos", note: "These stay in your old system's export." },
  { what: "Saved cards and autopay", note: "Card details do not move between payment processors. See the note on autopay below." },
];

const SWITCH_FAQ = [
  {
    q: "Do I need to give you my old login?",
    a: "No. You don't share a login to your old system with us. You only need the file you export from it.",
  },
  {
    q: "Will my customers hear from two systems at once?",
    a: "No. Imported customers get no messages from us until you press Go live. Do that once you stop using the old system.",
  },
  {
    q: "What file do I need?",
    a: "A CSV or Excel .xlsx file, up to 5 MB. Only the first sheet is read. An old .xls file needs to be saved as .xlsx or CSV first. Split a larger list into parts; customers already imported are recognised and not added twice.",
  },
  {
    q: "What if the import goes wrong?",
    a: "Every row is checked and you see what will happen before anything is added. After you import, you have 7 days to undo it. Customers you have already worked with are kept.",
  },
  {
    q: "When should I switch?",
    a: "Check your current contract's renewal date before you switch. You can import and set up here while your old system keeps running, then go live when you're ready.",
  },
  {
    q: "Can you do the import for me?",
    a: "Yes. Send us your export and we'll help bring it over. White label includes setup done with you, with your customer list brought over.",
  },
];

export default function SwitchPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumb(PAGE.label, PAGE.path),
          { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: SWITCH_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
        ]}
      />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 pt-16 pb-12 sm:px-6">
        <p className="text-sm font-semibold tracking-[0.14em] text-accent uppercase">Switching</p>
        <h1 className="max-w-[22ch] text-4xl font-semibold tracking-tight text-balance md:text-5xl">Switch pest control software without losing a customer.</h1>
        <p className="max-w-[60ch] text-lg text-fg-muted">
          Moving from FieldRoutes, PestPac, GorillaDesk, Jobber or a spreadsheet? Bring your customer list over from your own export, check every row before anything is added, and undo for 7 days. Your customers hear nothing from us until you go live.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Cta />
          <SecondaryCta href={ASK}>Send us your export</SecondaryCta>
        </div>
      </section>

      <section aria-labelledby="export-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="export-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              What to export from your old software.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">
              Your customer list, as a CSV or Excel file. Every product puts its export in a different menu. If you can&apos;t find it, or you&apos;re not sure the file has what you need,{" "}
              <a href={ASK} className={LINK}>
                send us the file
              </a>
              .
            </p>
          </div>
          <div className="grid content-start gap-4">
            <p className="text-md font-semibold">Make sure it has a column for:</p>
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {EXPORT_LIST.map((item) => (
                <li key={item} className="flex gap-3 text-md">
                  <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-md text-fg-muted">Set up your service plans here first. A plan in your file is matched to one of yours by name.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10">
          <div className="grid gap-4">
            <h2 id="steps-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              How the move works.
            </h2>
            <p className="max-w-[56ch] text-lg text-fg-muted">One page, in order. Nothing is added until you have checked every row and pressed Import.</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid content-start gap-3 rounded-panel border border-line bg-surface p-6">
                <span className="flex size-9 items-center justify-center rounded-pill bg-accent-soft text-md font-semibold text-accent tabular" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="text-xl font-semibold">{s.title}</h3>
                <p className="text-md text-fg-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="live-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-6 rounded-panel border border-line bg-sunken p-8 md:p-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-3">
            <h2 id="live-title" className="text-2xl font-semibold tracking-tight md:text-3xl">
              Your old system keeps running until you go live.
            </h2>
            <p className="max-w-[48ch] text-md text-fg-muted">
              Imported customers get no reminders or notices from us until you press Go live, so nobody hears from two systems at once. Do it once you stop using the old system.
            </p>
          </div>
          <div className="grid content-start gap-4">
            <p className="text-md font-semibold">A switch-over checklist walks you through it:</p>
            <ol className="grid list-decimal gap-2 pl-5 text-md">
              <li>Bring your customers over</li>
              <li>Invite your technicians</li>
              <li>Plan your first route</li>
              <li>Turn on email</li>
              <li>Connect card payments through your own Stripe account</li>
              <li>Go live</li>
            </ol>
            <p className="text-md text-fg-muted">
              When you switch over, you can send each customer one email saying their account has a new home, with a link to sign in and an optional note from you.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="over-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6">
          <div className="grid gap-4">
            <h2 id="over-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              What comes over, and what doesn&apos;t yet.
            </h2>
            <p className="max-w-[56ch] text-lg text-fg-muted">The import brings over your customer list. Here is the whole picture.</p>
          </div>
          <div className="grid gap-10 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <h3 className="text-xl font-semibold">Comes over from your file</h3>
              <ul className="grid gap-3">
                {COMES_OVER.map((item) => (
                  <li key={item} className="flex gap-3 text-md">
                    <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid content-start gap-4">
              <h3 className="text-xl font-semibold">Not imported yet</h3>
              <dl className="grid divide-y divide-line border-y border-line">
                {NOT_YET.map((n) => (
                  <div key={n.what} className="grid gap-1 py-4">
                    <dt className="flex items-center gap-2 text-md font-semibold">
                      <Clock size={18} className="shrink-0 text-fg-muted" aria-hidden /> {n.what}
                    </dt>
                    <dd className="text-md text-fg-muted">{n.note}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-md text-fg-muted">
                Not sure what to keep from your old records?{" "}
                <Link href={SITE_PAGES.utahRecords.path} className={LINK}>
                  See what Utah asks applicators to keep
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="autopay-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 id="autopay-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Autopay customers.
          </h2>
          <div className="grid content-start gap-3">
            <p className="max-w-[60ch] text-lg text-fg-muted">
              Saved cards can&apos;t be moved from your old payment processor, so autopay customers set it up again. Once you connect your own Stripe account, each customer signs in to their portal with their email, adds a card or bank account, and turns autopay on. They can turn it off there too.
            </p>
            <p className="max-w-[60ch] text-md text-fg-muted">The switch-over email gives every customer the sign-in link, so it is a good moment to ask.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="leave-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-6 rounded-panel border border-line bg-sunken p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-12">
          <div className="grid gap-3">
            <h2 id="leave-title" className="flex items-center gap-3 text-2xl font-semibold tracking-tight md:text-3xl">
              <FileArrowDown size={28} className="shrink-0 text-accent" aria-hidden /> When you leave us, it&apos;s just as easy.
            </h2>
            <p className="max-w-[64ch] text-md text-fg-muted">
              Export everything any time, at no charge: one ZIP file with every table as CSV and JSON, your customer list ready to import anywhere, every pesticide application record as a PDF per month, and all photos, signatures and documents. The download link works for 7 days.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SecondaryCta href={SITE_PAGES.security.path}>Security and your data</SecondaryCta>
          </div>
        </div>
      </section>

      <section aria-labelledby="switch-faq-title" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <h2 id="switch-faq-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Switching questions.
          </h2>
          <dl className="grid divide-y divide-line border-y border-line">
            {SWITCH_FAQ.map((f) => (
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
              Bring your customers over.
            </h2>
            <p className="max-w-[52ch] text-lg text-fg-muted">
              Start with your own export, or send it to us and we&apos;ll help. Month to month, every feature on every plan.{" "}
              <Link href={SITE_PAGES.pricing.path} className={LINK}>
                See pricing
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SecondaryCta href={ASK}>Email us your export</SecondaryCta>
            <Cta />
          </div>
        </div>
      </section>
    </>
  );
}
