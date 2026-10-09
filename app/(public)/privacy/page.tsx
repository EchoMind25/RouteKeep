import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { BRAND } from "@/lib/brand";
import { publicEnv } from "@/lib/public-env";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" }, robots: { index: true, follow: true } };

const us = () => publicEnv.legalName || BRAND.name;

// CR-13, NFR-08: what we collect, why, and who else sees it.
export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="October 8, 2026">
      <p>
        This policy explains how {us()} handles information in {BRAND.name}. We don&apos;t sell data, we don&apos;t use it for advertising, and our app has no tracking or analytics scripts.
      </p>
      <h2>Two kinds of information</h2>
      <ul>
        <li>
          <strong>Business account information</strong>: the names, emails and roles of the people a business invites, and the business&apos;s details. We are responsible for this.
        </li>
        <li>
          <strong>The business&apos;s customer data</strong>: customers, addresses, visits, application records, invoices, payments and messages. The business decides what goes in and owns it; we
          process it only on its behalf (see the <Link href="/dpa" className="underline">Data Processing Addendum</Link>). If you are a customer of a business that uses {BRAND.name}, contact that
          business about your information.
        </li>
      </ul>
      <h2>What we use it for</h2>
      <ul>
        <li>Running the service: scheduling, routes, records, invoices and the messages the business sends.</li>
        <li>Keeping it secure, fixing problems, and answering support requests.</li>
        <li>Billing the business for its plan.</li>
      </ul>
      <h2>Who else sees it</h2>
      <p>
        A few services help us run {BRAND.name}. Each gets only what it needs; the full list is on the <Link href="/subprocessors" className="underline">subprocessors page</Link>. Two worth knowing:
        street addresses (never names or phone numbers) go to a mapping service to place pins, and when someone asks for an AI route plan, the AI service receives stop numbers, time windows,
        distances and notes with numbers, phone numbers and emails removed. It never receives names or addresses.
      </p>
      <h2>Cookies</h2>
      <p>We use cookies only to keep you signed in. No advertising or tracking cookies.</p>
      <h2>Security</h2>
      <p>
        Each business&apos;s data is separated in the database itself, not just in the app, and checked by automated tests on every change. Data is encrypted in transit. Card numbers are entered
        only in the payment processor&apos;s own form and never reach our servers.
      </p>
      <h2>How long we keep it</h2>
      <p>
        While the account is open. Pesticide application records are kept at least two years, as state rules require. After an account closes, the business has 30 days to export, then we delete its
        data except what the law requires us to keep.
      </p>
      <h2>Email</h2>
      <p>Every email a business sends through {BRAND.name} has a link to stop them. Sign-in links are sent only when someone asks for one.</p>
      <h2>Contact</h2>
      <p>
        Questions or requests:{" "}
        <a href={`mailto:${publicEnv.salesEmail}`} className="underline">
          {publicEnv.salesEmail}
        </a>
        .
      </p>
    </LegalDoc>
  );
}
