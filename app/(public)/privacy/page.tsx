import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { BRAND } from "@/lib/brand";
import { LEGAL_UPDATED, PRODUCT_DATA_LEVELS, RETENTION } from "@/lib/legal/policy";
import { publicEnv } from "@/lib/public-env";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" }, robots: { index: true, follow: true } };

const us = () => publicEnv.legalName || BRAND.name;

// CR-13, CR-17, NFR-08: what we collect, why, who else sees it, how long we
// keep it and how to control it. Every claim here matches what is built.
export default function PrivacyPage() {
  const email = publicEnv.salesEmail;
  return (
    <LegalDoc title="Privacy Policy" updated={LEGAL_UPDATED}>
      <p>
        This policy explains how {us()} (&quot;we&quot;) handles information in {BRAND.name}, the app and this website. The short version: we collect what the service needs to work, we don&apos;t
        sell or rent data, we don&apos;t use it for advertising, and each business decides whether we may learn anything from how it uses the app.
      </p>

      <h2 id="roles">Who is responsible for what</h2>
      <ul>
        <li>
          <strong>Businesses that use {BRAND.name}</strong> own their customer and staff records and decide what goes in. For that data we are their service provider (processor) and act only on
          their instructions, under the <Link href="/dpa" className="underline">Data Processing Addendum</Link>. If you are a customer or employee of a business that uses {BRAND.name}, contact
          that business first; we will help it answer you.
        </li>
        <li>
          <strong>We are responsible</strong> for account details of the people who sign up and sign in, billing for our own plans, website visits, support conversations, and the product data
          described below.
        </li>
      </ul>

      <h2 id="collect">What we collect</h2>
      <ul>
        <li>
          <strong>Account and sign-in:</strong> name, work email, role, the business you belong to, sign-in times, and a two-step sign-in factor for owners and admins.
        </li>
        <li>
          <strong>Business records the business enters:</strong> customers, phone numbers, emails, service addresses, property notes, plans, visits, photos, signatures (with the signer&apos;s IP
          address and browser, as proof of signing), pesticide application records, invoices, payments, credits and messages.
        </li>
        <li>
          <strong>Field staff work records:</strong> which visits a technician was assigned, arrival and completion times, application records with their applicator license number, product
          used per visit, the truck or vehicle they are assigned, stock counts they submit on resupply day, and the changes they make (kept in a change history). See the{" "}
          <Link href="/employee-notice" className="underline">field staff notice</Link>.
        </li>
        <li>
          <strong>Location:</strong> service addresses are placed on a map. The app does <strong>not</strong> read a phone&apos;s GPS or track where a technician or truck is. If that ever
          changes, we will update this policy first, the business must turn it on, and the phone will ask the technician for permission.
        </li>
        <li>
          <strong>Website visits and requests:</strong> our host keeps request logs with IP address, browser, page requested and time, for security and to keep the site running.
        </li>
        <li>
          <strong>Support:</strong> what you send us when you ask for help.
        </li>
      </ul>
      <p>We do not collect Social Security numbers, card numbers (those go only to the payment processor&apos;s own form), health information or biometric data.</p>

      <h2 id="use">What we use it for</h2>
      <ul>
        <li>Running the service: scheduling, routes, the technician app, records, invoices, payments, resupply planning and the messages the business sends.</li>
        <li>Keeping it secure: sign-in, two-step sign-in, abuse prevention, and investigating problems.</li>
        <li>Support, and billing the business for its plan.</li>
        <li>Improving the product, only as each business allows (next section).</li>
        <li>Meeting legal duties, such as keeping pesticide records as long as state rules require.</li>
      </ul>
      <p>We never use business records to train AI models, and we never use them for advertising.</p>

      <h2 id="product-data">Product improvement data, and the business&apos;s choice</h2>
      <p>
        To find bugs and make the app better, we can record how the app is used: errors, how long screens take, which features get used, and moments where the app&apos;s suggestion was not
        followed, such as a dispatcher changing a suggested route. Each business picks one of three levels in Settings, and can change it at any time:
      </p>
      <ul>
        {PRODUCT_DATA_LEVELS.map((l) => (
          <li key={l.key}>
            <strong>{l.label}:</strong> {l.summary}
          </li>
        ))}
      </ul>
      <p>
        At every level, product data never contains customer names, addresses, phone numbers, emails, notes, messages, photos, signatures or payment details, and never a person&apos;s name,
        user id, IP address, location or device id. Error messages are scrubbed of anything that looks like contact details or ids. Events are timed to the hour, stored in our own database (no
        third-party analytics), kept 180 days, and readable only by our developers through an audited console. Anonymous data can&apos;t be traced back to a business, so it can&apos;t be
        deleted per business; we don&apos;t try to re-identify it and don&apos;t let anyone else try. Each person can also stop their own browser sending measurement with &quot;Essential only&quot;
        in the cookie banner, and browsers that send Global Privacy Control never send it; events recorded on our servers follow the business&apos;s setting. On the public website we record only anonymous error reports, no page views.
      </p>
      <h2 id="ai">AI features</h2>
      <p>
        When someone asks for an AI route plan, the AI service receives stop numbers, service types, time windows, distances and notes with numbers, phone numbers and emails removed. It never
        receives names or addresses, and under its terms it does not train on what we send.
      </p>

      <h2 id="sharing">Who else sees it</h2>
      <p>
        We don&apos;t sell personal information, and we don&apos;t share it for cross-context behavioral advertising. A few services help us run {BRAND.name}; each gets only what it needs and
        is listed with exactly what it receives on the <Link href="/subprocessors" className="underline">subprocessors page</Link>. Street addresses (never names or phone numbers) go to a
        mapping service to place pins. Otherwise we disclose information only when the law requires it, to protect people from harm, or as part of a sale or merger of our business, where the
        buyer must keep this policy&apos;s promises.
      </p>

      <h2 id="texts">Text messages</h2>
      <p>
        When a business turns on texts, it may text its customers only with their consent, and every text says how to stop (reply STOP). Mobile numbers and text consent are never shared with
        third parties or affiliates for their marketing.
      </p>

      <h2 id="cookies">Cookies</h2>
      <p>
        We use cookies and browser storage only to keep you signed in, keep the technician app working offline, and remember your cookie choice. There are no advertising or tracking
        cookies, and product measurement uses no cookies at all. The full list is in the <Link href="/cookies" className="underline">cookie policy</Link>.
        You can change your choice from &quot;Privacy choices&quot; at the bottom of any public page.
      </p>

      <h2 id="security">Security</h2>
      <p>
        Each business&apos;s data is separated in the database itself, not just in the app, and checked by automated tests on every change. Data is encrypted in transit and at rest with our
        database provider. Owners and admins use two-step sign-in. No system is perfectly secure; if a breach affects your information we will tell the business without undue delay and help it
        notify you as the law requires.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <ul>
        {RETENTION.map((r) => (
          <li key={r.what}>
            <strong>{r.what}:</strong> {r.howLong}
          </li>
        ))}
      </ul>

      <h2 id="rights">Your rights and choices</h2>
      <p>
        Wherever you live, you can ask us to tell you what we hold about you, give you a copy, correct it, or delete it, and you can opt out of optional measurement. Some US states give these
        rights by law (for example California, Colorado, Connecticut, Utah and Virginia), and residents of the UK and EU have them under data protection law. We give them to everyone.
      </p>
      <ul>
        <li>For a business&apos;s customer or staff records, ask the business; it can view, correct, export and delete them in the app, and we help when asked.</li>
        <li>
          For anything else, email{" "}
          <a href={`mailto:${email}?subject=${encodeURIComponent("Privacy request")}`} className="underline">
            {email}
          </a>
          . We confirm who you are using the email on file, answer within 45 days, and won&apos;t treat you differently for asking. An authorized agent may ask for you with your signed
          permission. If we say no, you can ask us to reconsider by replying, and you may contact your state attorney general or data protection authority.
        </li>
        <li>We treat Global Privacy Control, on the website and in the app, as an opt-out of optional measurement.</li>
      </ul>

      <h2 id="where">Where data is stored</h2>
      <p>Data is stored in the United States. If you use {BRAND.name} from outside the US, your information is transferred to and processed in the US.</p>

      <h2 id="children">Children</h2>
      <p>{BRAND.name} is for businesses and is not meant for children under 16. We do not knowingly collect their information; if you think we have, tell us and we will delete it.</p>

      <h2 id="changes">Changes</h2>
      <p>
        We will post any change here with a new date. For a material change, we will tell account owners by email at least 30 days before it takes effect, and we will never start using data
        already collected in a materially different way without asking first.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        {us()}, privacy questions and requests:{" "}
        <a href={`mailto:${email}?subject=${encodeURIComponent("Privacy question")}`} className="underline">
          {email}
        </a>
        .
      </p>
    </LegalDoc>
  );
}
