import { ArrowSquareOut, CheckCircle, Clock, Info } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Cta, SecondaryCta } from "@/components/marketing/cta";
import { breadcrumb, JsonLd } from "@/components/marketing/json-ld";
import { BRAND } from "@/lib/brand";
import { pageMetadata, SITE_PAGES } from "@/lib/landing/pages";
import { publicEnv } from "@/lib/public-env";

// FR-WEB-01: a plain guide to Utah's pesticide application record rule
// (R68-7-11(11), R68-7-16(3) and (4), R68-7-17). Every rule point below was
// checked against the rule text on 2026-10-09; the sources list names where.
// The "How RouteVerde handles it" list is limited to what is built: see
// lib/domain/records.ts, components/tech/stop-screen.tsx, lib/server/records.ts,
// lib/records/service-record-pdf.tsx and lib/reports/product-usage.ts.

const PAGE = SITE_PAGES.utahRecords;
export const metadata = pageMetadata(PAGE);

const CHECKED = "9 October 2026";
const CHECKED_ISO = "2026-10-09";

const linkClass = "font-semibold text-accent underline underline-offset-4 hover:text-accent-hover";

const FIELDS = [
  {
    field: "Customer name and address",
    cite: "R68-7-11(11)(b)(i)",
    note: "The person or business you applied the pesticide for.",
  },
  {
    field: "Application address, if different",
    cite: "R68-7-11(11)(b)(ii)",
    note: "Where the product went down, when that is not the customer's address. A landlord who lives elsewhere is the common case.",
  },
  {
    field: "Size of the area treated",
    cite: "R68-7-11(11)(b)(iii)",
    note: "Total square footage, or the total size of the area in another unit that fits the job.",
  },
  {
    field: "Specific target sites",
    cite: "R68-7-11(11)(b)(iv)",
    note: "What you treated: for example the foundation perimeter, eaves, lawn or shrub beds. The rule also names crops, commodities and stored products.",
  },
  {
    field: "Date and time",
    cite: "R68-7-11(11)(b)(v)",
    note: "When the pesticide was applied, with the month, day and year.",
  },
  {
    field: "Brand name, EPA registration number and mix rate",
    cite: "R68-7-11(11)(b)(vi)",
    note: "For every pesticide applied on the visit, not only the main one.",
  },
  {
    field: "Total amount applied",
    cite: "R68-7-11(11)(b)(vii)",
    note: "Per location and per application, and the rule says this includes diluted and ready to use (RTU) products.",
  },
  {
    field: "Purpose, target site and pest",
    cite: "R68-7-11(11)(b)(viii)",
    note: "Why you applied it and which pest you were treating, such as ants, spiders or grubs.",
  },
  {
    field: "Applicator name, business address and license number",
    cite: "R68-7-11(11)(b)(ix)",
    note: "The certified applicator who made the application, your commercial pesticide business address, and that applicator's commercial license number.",
  },
  {
    field: "Business name and business license number",
    cite: "R68-7-16(3)(b)",
    note: "Not in the record list itself, but a separate subsection says both must be prominently displayed on service records and service notifications.",
  },
];

const STATEMENT = [
  "Your pesticide business name, business license number and phone number",
  "The name and license number of the applicator who will make the application",
  "The date and time of the application",
  "The type of service, and the brand name and EPA registration number of the pesticides",
  "A line telling the customer to call your business number for more detail about the product",
];

const BUILT = [
  "The technician app asks for each record field on the stop: customer, application address, area treated, target sites, target pests, date and time, brand name, EPA registration number, mix rate, total amount, applicator name and license number, and your business name, address and license number.",
  "A tech cannot complete the stop while any field is missing, and the screen names the missing one. The server runs the same check again before it saves the record.",
  "At 20 hours after the visit started, the tech sees a \"record due by\" warning, and the office schedule lists the stop as needing its record. At 24 hours the warning says it is overdue.",
  "For a restricted use product with a Danger or Danger-Poison signal word, the tech must confirm the customer received the written statement before the stop can close. The time is saved on the record.",
  "Every service record PDF carries your business name and pesticide business license number.",
  "Product usage reports by date range, product, EPA number and technician, as CSV or PDF.",
];

const FAQ = [
  {
    q: "How long do I keep pesticide application records in Utah?",
    a: "At least two years from the date of the application, under Utah Admin. Code R68-7-11(11)(c). Termite structure diagrams are also kept for two years, organized separately for each structure, under R68-7-17.",
  },
  {
    q: "How soon do I have to record a pesticide application in Utah?",
    a: "Within 24 hours after the application is made. That is R68-7-11(11)(a).",
  },
  {
    q: "Do I need the EPA registration number on every record?",
    a: "Yes. R68-7-11(11)(b)(vi) asks for the brand name, EPA registration number and mix rate of every pesticide applied.",
  },
  {
    q: "Does my business name have to be on the service record?",
    a: "Yes. R68-7-16(3)(b) says the business name and business license number must be prominently displayed on service records and service notifications. The record itself must also list the applicator's name, business address and license number.",
  },
  {
    q: "What do I give a customer before a restricted use application?",
    a: "Before each application of a restricted use pesticide with a Danger or Danger-Poison signal word, a written statement with your business name, license number and phone, the applicator's name and license number, the date and time, the service type, the brand name and EPA number, and a line to call you for more detail. That is R68-7-16(4).",
  },
  {
    q: "Can the Utah Department of Agriculture and Food ask to see my records?",
    a: "Yes. R68-7-11(11)(c) says records must be available for inspection by the department on request, and (11)(d) says they must be furnished in a uniform format.",
  },
];

const SOURCES = [
  { label: "Utah Admin. Code R68-7-11, Commercial Pesticide Applicator and Commercial Pesticide Business License Issuance (see subsection 11, records)", href: "https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R68-7-11" },
  { label: "Utah Admin. Code R68-7-16, Responsibilities of Pesticide Applicator Businesses and Pesticide Applicators", href: "https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R68-7-16" },
  { label: "Utah Admin. Code R68-7-17, Termiticide Record Keeping: Additional Requirements", href: "https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R68-7-17" },
  { label: "Utah Admin. Code R68-7, Utah Pesticide Control Rule (all sections)", href: "https://www.law.cornell.edu/regulations/utah/agriculture-and-food/title-R68/rule-R68-7" },
  { label: "Utah Department of Agriculture and Food, Pesticides program", href: "https://ag.utah.gov/pesticides/" },
  { label: "Utah Office of Administrative Rules, the official published code", href: "https://adminrules.utah.gov/" },
];

export default function UtahRecordsPage() {
  const url = publicEnv.siteUrl;
  return (
    <>
      <JsonLd
        data={[
          breadcrumb(PAGE.label, PAGE.path),
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: PAGE.title,
            description: PAGE.description,
            datePublished: CHECKED_ISO,
            dateModified: CHECKED_ISO,
            inLanguage: "en-US",
            mainEntityOfPage: `${url}${PAGE.path}`,
            author: { "@type": "Organization", "@id": `${url}/#organization`, name: BRAND.name },
            publisher: { "@type": "Organization", "@id": `${url}/#organization`, name: BRAND.name },
            about: "Utah Administrative Code R68-7 pesticide application record keeping",
          },
          { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
        ]}
      />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 pt-16 pb-12 sm:px-6">
        <p className="text-sm font-semibold tracking-[0.14em] text-accent uppercase">Utah spray records</p>
        <h1 className="max-w-[22ch] text-4xl font-semibold tracking-tight text-balance md:text-5xl">Utah pesticide application records: what to keep.</h1>
        <p className="max-w-[60ch] text-lg text-fg-muted">
          Utah&apos;s pesticide rule, R68-7, tells commercial applicators what to write down after every application, how fast, and for how long. Here is each requirement in plain words, with the rule section next to it so you can check it yourself.
        </p>
        <p className="flex items-center gap-2 text-md text-fg-muted">
          <Clock size={18} className="shrink-0" aria-hidden />
          <span>
            Last checked <time dateTime={CHECKED_ISO}>{CHECKED}</time>. A plain summary, not legal advice.
          </span>
        </p>
      </section>

      <section aria-labelledby="who-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 id="who-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Who this applies to.
          </h2>
          <div className="grid max-w-[64ch] gap-4 text-md text-fg-muted">
            <p>
              The record rule in R68-7-11(11) is written for <strong className="font-semibold text-fg">commercial applicators</strong>: if you or your techs apply pesticides for paying customers under a Utah commercial license, it is about you. That covers the usual pest control and lawn care shop, from one truck to many.
            </p>
            <p>
              The business rules in R68-7-16 apply to the licensed pesticide business and its applicators. Non-commercial and private applicators have their own sections (R68-7-12 and R68-7-13), which this page does not cover. If you are not sure which you are, ask the Utah Department of Agriculture and Food.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="fields-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="fields-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              What every record must include.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">R68-7-11(11)(b) lists nine items. One more, your business name and license number, comes from R68-7-16.</p>
          </div>
          <dl className="grid divide-y divide-line border-y border-line">
            {FIELDS.map((f) => (
              <div key={f.field} className="grid gap-1 py-5 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)] sm:gap-6">
                <dt className="grid content-start gap-1">
                  <span className="text-lg font-semibold">{f.field}</span>
                  <span className="text-sm text-fg-muted tabular">{f.cite}</span>
                </dt>
                <dd className="text-md text-fg-muted">{f.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="timing-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 id="timing-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Record it within 24 hours.
          </h2>
          <div className="grid max-w-[64ch] gap-4 text-md text-fg-muted">
            <p>
              R68-7-11(11)(a) says records &quot;shall be recorded within 24 hours after the pesticide application is made.&quot; A record written up at the end of the week does not meet it. The simplest habit is to finish the record before you leave the property.
            </p>
            <p>
              The rule also says records &quot;shall be furnished in a uniform format&quot; (R68-7-11(11)(d)). It does not spell out the format. Using the same form or app for every application keeps you on the right side of it.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="statement-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-10 rounded-panel border border-line bg-sunken p-8 md:p-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="statement-title" className="text-2xl font-semibold tracking-tight md:text-3xl">
              Restricted use products: a written statement first.
            </h2>
            <p className="max-w-[44ch] text-md text-fg-muted">
              R68-7-16(4) applies before each application of a restricted use pesticide with a Danger or Danger-Poison signal word. You, or an employee of your licensed business, give the customer a written statement.
            </p>
          </div>
          <div className="grid content-start gap-5">
            <div className="grid gap-3">
              <h3 className="text-lg font-semibold">The statement must include</h3>
              <ul className="grid gap-2 text-md">
                {STATEMENT.map((s) => (
                  <li key={s} className="flex gap-3">
                    <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-3">
              <h3 className="text-lg font-semibold">How to deliver it</h3>
              <p className="max-w-[64ch] text-md text-fg-muted">
                Leave it at the residence. At a multi-unit residence, leave it with the property manager or their representative. If management is off site, you may mail it to them, and the rule says the mailed statement goes at least seven calendar days before the application.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="termite-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 id="termite-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Termite jobs: keep a diagram.
          </h2>
          <div className="grid max-w-[64ch] gap-4 text-md text-fg-muted">
            <p>
              R68-7-17 adds to the normal record for termite work. You keep a diagram of the structure treated, with its dimensions and the depth to the footer the foundation rests on. For a treatment after construction, the diagram also shows where termites or termite activity were found.
            </p>
            <p>Keep the diagrams for two years, organized separately for each structure.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="keep-title" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 id="keep-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            How long to keep them, and who can ask.
          </h2>
          <dl className="grid divide-y divide-line border-y border-line">
            <div className="grid gap-1 py-5 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] sm:gap-6">
              <dt className="text-lg font-semibold">Application records</dt>
              <dd className="text-md text-fg-muted">At least two years from the date of the application. R68-7-11(11)(c).</dd>
            </div>
            <div className="grid gap-1 py-5 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] sm:gap-6">
              <dt className="text-lg font-semibold">Termite diagrams</dt>
              <dd className="text-md text-fg-muted">Two years, kept separately for each structure. R68-7-17.</dd>
            </div>
            <div className="grid gap-1 py-5 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] sm:gap-6">
              <dt className="text-lg font-semibold">Training records</dt>
              <dd className="text-md text-fg-muted">
                Your business also keeps a record of pesticide training and who attended, with agendas and materials kept for two years after an employee leaves. R68-7-16(1)(b).
              </dd>
            </div>
            <div className="grid gap-1 py-5 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] sm:gap-6">
              <dt className="text-lg font-semibold">Who can ask to see them</dt>
              <dd className="text-md text-fg-muted">
                The Utah Department of Agriculture and Food. Records must be available for inspection by the department on request (R68-7-11(11)(c)). Under R68-7-16(2)(b), not answering the department&apos;s request for information within two business days can count as evidence that you did not train or equip your employees.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="built-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-4">
            <h2 id="built-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              How {BRAND.name} handles it.
            </h2>
            <p className="max-w-[44ch] text-lg text-fg-muted">
              Records are part of every plan. <Link href={SITE_PAGES.pricing.path} className={linkClass}>See pricing</Link>.
            </p>
          </div>
          <div className="grid content-start gap-6">
            <ul className="grid gap-3">
              {BUILT.map((item) => (
                <li key={item} className="flex gap-3 text-md">
                  <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="flex gap-3 text-md text-fg-muted">
              <Clock size={20} className="mt-0.5 shrink-0" aria-hidden />
              <span>Not built yet: termite structure diagrams. Keep those in your own files for now.</span>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="records-faq-title" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <h2 id="records-faq-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Utah record questions.
          </h2>
          <dl className="grid divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <div key={f.q} className="grid gap-2 py-5">
                <dt className="text-lg font-semibold">{f.q}</dt>
                <dd className="max-w-[68ch] text-md text-fg-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="sources-title" className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div className="grid content-start gap-4">
            <h2 id="sources-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Sources.
            </h2>
            <p className="text-md text-fg-muted">
              Checked <time dateTime={CHECKED_ISO}>{CHECKED}</time>. The rule sections were read as amended effective 7 September 2022.
            </p>
          </div>
          <div className="grid content-start gap-6">
            <ul className="grid gap-3">
              {SOURCES.map((s) => (
                <li key={s.href} className="flex gap-3 text-md">
                  <ArrowSquareOut size={20} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
                  <a href={s.href} className={linkClass} rel="noopener">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex gap-3 rounded-panel border border-line bg-sunken p-6 text-md">
              <Info size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p className="grid gap-2">
                <span className="font-semibold">This is a plain summary, not legal advice. Confirm with the Utah Department of Agriculture and Food pesticide program.</span>
                <span className="text-fg-muted">
                  The program&apos;s listed phone number is <a href="tel:+18019822300" className={linkClass}>(801) 982-2300</a>. Rules change, so check the current text before you rely on any one line here.
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="close-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-3">
            <h2 id="close-title" className="max-w-[22ch] text-4xl font-semibold tracking-tight text-balance">
              Records that are complete before the truck leaves.
            </h2>
            <p className="max-w-[52ch] text-lg text-fg-muted">
              Moving from other software? <Link href={SITE_PAGES.switch.path} className={linkClass}>See how switching works</Link>. Curious where the records are kept? <Link href={SITE_PAGES.security.path} className={linkClass}>Read about security and privacy</Link>.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SecondaryCta href="/#faq">More questions</SecondaryCta>
            <Cta />
          </div>
        </div>
      </section>
    </>
  );
}
