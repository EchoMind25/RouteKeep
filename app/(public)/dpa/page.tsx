import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { BRAND } from "@/lib/brand";
import { publicEnv } from "@/lib/public-env";

export const metadata: Metadata = { title: "Data Processing Addendum", alternates: { canonical: "/dpa" } };

const us = () => publicEnv.legalName || BRAND.name;

// CR-13: how we handle the business's customer data on its behalf.
export default function DpaPage() {
  return (
    <LegalDoc title="Data Processing Addendum" updated="October 8, 2026">
      <p>
        This addendum is part of the <Link href="/terms" className="underline">Terms of Service</Link> between {us()} (&quot;processor&quot;) and the business using {BRAND.name}
        (&quot;controller&quot;). It covers the personal data of the business&apos;s customers and staff that we process to provide the service.
      </p>
      <h2>Instructions</h2>
      <p>We process the data only to provide the service and as the business directs through it, and not for any other purpose.</p>
      <h2>Confidentiality and security</h2>
      <ul>
        <li>Only people who need access to provide or support the service have it, and they are bound to keep it confidential.</li>
        <li>Each business&apos;s data is isolated by row-level security in the database, tested automatically on every change.</li>
        <li>Data is encrypted in transit; production data has automated daily backups and a tested restore before it holds real customer records.</li>
        <li>Card data never reaches our systems.</li>
      </ul>
      <h2>Subprocessors</h2>
      <p>
        The business authorizes the services on the <Link href="/subprocessors" className="underline">subprocessors page</Link>. We will post changes there at least 30 days before a new subprocessor
        receives customer data, and the business may object by ending the agreement.
      </p>
      <h2>Breaches</h2>
      <p>We will tell the business without undue delay, and within 72 hours of confirming a breach affecting its data, with what we know and what we are doing about it.</p>
      <h2>Help with requests</h2>
      <p>We will help the business answer requests from its customers to see, correct or delete their information, mostly through tools in the app (edit, export).</p>
      <h2>End of service</h2>
      <p>The business can export everything at any time. After the account closes we delete the data within 30 days, except what the law requires us to keep.</p>
      <h2>Contact</h2>
      <p>
        <a href={`mailto:${publicEnv.salesEmail}`} className="underline">
          {publicEnv.salesEmail}
        </a>
      </p>
    </LegalDoc>
  );
}
