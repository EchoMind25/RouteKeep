import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { BRAND } from "@/lib/brand";
import { publicEnv } from "@/lib/public-env";
import { LEGAL_UPDATED } from "@/lib/legal/policy";

export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" }, robots: { index: true, follow: true } };

const us = () => publicEnv.legalName || BRAND.name;

// CR-13: plain terms for customer one. A template until reviewed (D-13).
export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated={LEGAL_UPDATED}>
      <p>
        These terms are an agreement between {us()} (&quot;we&quot;) and the business that signs up for {BRAND.name} (&quot;you&quot;). By creating an account you agree to them. If you
        don&apos;t agree, don&apos;t use the service.
      </p>
      <h2>What we provide</h2>
      <p>
        {BRAND.name} is software for pest control and lawn care businesses: customers, plans, scheduling, routes, a technician app, application records, invoicing, a customer account
        area and messages. Some parts depend on services you choose to connect, such as payments or text messages.
      </p>
      <h2>Your account and your people</h2>
      <ul>
        <li>You are responsible for who you invite and what they do in your account.</li>
        <li>Keep sign-in links and devices secure. Tell us right away if you think someone got in who shouldn&apos;t have.</li>
        <li>You must be able to enter into this agreement for your business.</li>
      </ul>
      <h2>Your data is yours</h2>
      <p>
        Everything you and your customers put in belongs to you. We use it only to run the service for you, as described in our <Link href="/privacy" className="underline">Privacy Policy</Link> and{" "}
        <Link href="/dpa" className="underline">Data Processing Addendum</Link>. You can export all of it at any time from Settings, Export, in formats any spreadsheet can open.
      </p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>Pesticide application records, licenses and state rules are your responsibility. The software asks for the fields Utah&apos;s rule lists and keeps records for you, but you are responsible for what is entered and for meeting your state&apos;s requirements.</li>
        <li>Only message customers you are allowed to. Texts require the customer&apos;s consent and an approved carrier registration; the software enforces both but relies on what you record.</li>
        <li>Don&apos;t use the service for anything unlawful, to send spam, or to try to get at other businesses&apos; data.</li>
        <li>
          You have the right to put your customers&apos; and staff&apos;s information in the app, and you give your staff the{" "}
          <Link href="/employee-notice" className="underline">field staff notice</Link> (or your own equivalent) and meet your state&apos;s rules on notice of workplace monitoring.
        </li>
        <li>Don&apos;t probe, scan or load test the service, copy it, or resell it without our written agreement (white label is that agreement).</li>
      </ul>
      <h2>Suggestions, forecasts and AI</h2>
      <p>
        Route plans, AI plans, usage forecasts, resupply lists and stock counts are aids to your judgment. They depend on the records you keep and can be wrong. You decide what to apply, order
        and schedule, and the product label is the law: never follow a suggestion that conflicts with it.
      </p>
      <h2>Product data and your choice</h2>
      <p>
        You choose in Settings whether we may record how your business uses the app to improve it: off, anonymous, or shared with your business name, as the{" "}
        <Link href="/privacy#product-data" className="underline">Privacy Policy</Link> describes. We use it only to run, secure and improve {BRAND.name}, never to sell or for advertising, and it
        never includes your customers&apos; details. If you send us feedback, we may use it without owing you anything.
      </p>
      <h2>Fees</h2>
      <ul>
        <li>Plans are billed monthly in advance at the price posted when you subscribe, based on your number of active customers. No contract: cancel any month and you won&apos;t be billed again.</li>
        <li>White label is a one-time fee of $5,000 for setup and a year of support, plus your monthly plan. Support after the first year is optional at $500 a year.</li>
        <li>Card processing fees for payments your customers make are set by the payment processor and paid by you.</li>
        <li>We will give you at least 30 days&apos; notice of a price change.</li>
      </ul>
      <h2>Availability</h2>
      <p>
        We work to keep the service running and your data safe, with daily backups once your account holds real customer records. We don&apos;t promise it will never be down. Current health is
        shown on our <Link href="/status" className="underline">status page</Link>. The technician app keeps working without a connection and uploads when it can.
      </p>
      <h2>Ending the agreement</h2>
      <p>
        You can cancel any time. We can end the agreement if you break these terms and don&apos;t fix it within 15 days of our notice, or right away for unlawful use. After cancellation you have 30
        days to export your data; after that we delete it, except what the law requires us to keep.
      </p>
      <h2>Limits</h2>
      <p>
        The service is provided as is. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability for any claim is limited to what you paid us in
        the 12 months before it arose.
      </p>
      <h2>Changes and law</h2>
      <p>
        We may update these terms and will tell you at least 30 days before a material change takes effect. Utah law governs these terms. Questions:{" "}
        <a href={`mailto:${publicEnv.salesEmail}`} className="underline">
          {publicEnv.salesEmail}
        </a>
        .
      </p>
    </LegalDoc>
  );
}
