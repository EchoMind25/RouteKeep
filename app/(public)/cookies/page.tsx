import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyChoicesLink } from "@/components/consent/cookie-banner";
import { LegalDoc } from "@/components/legal-doc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BRAND } from "@/lib/brand";
import { LEGAL_UPDATED, STORAGE } from "@/lib/legal/policy";

export const metadata: Metadata = { title: "Cookie Policy", alternates: { canonical: "/cookies" }, robots: { index: true, follow: true } };

// CR-17: every cookie and browser store, what it does and how long it lasts.
export default function CookiesPage() {
  return (
    <LegalDoc title="Cookie Policy" updated={LEGAL_UPDATED}>
      <p>
        {BRAND.name} uses a small number of cookies and browser storage, all of them our own. None are for advertising, none come from ad networks or social media sites, and none follow you to
        other websites.
      </p>
      <h2>Essential</h2>
      <p>
        These keep you signed in, let the technician app work without a signal, and remember your cookie choice. The service can&apos;t work without them, so they don&apos;t need your consent,
        but we still list every one.
      </p>
      <Table label="Cookies and browser storage">
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Type</TH>
            <TH>What it does</TH>
            <TH>How long</TH>
          </tr>
        </THead>
        <TBody>
          {STORAGE.filter((s) => s.category === "Essential").map((s) => (
            <TR key={s.name}>
              <TD className="font-mono text-sm">{s.name}</TD>
              <TD>{s.kind}</TD>
              <TD>{s.purpose}</TD>
              <TD>{s.duration}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <h2>Anonymous measurement (no cookies)</h2>
      <p>
        If you choose &quot;Allow&quot;, the app sends anonymous error reports and what happens to automatic route suggestions, so we can fix and improve it. It uses no cookies or browser
        storage, no advertising ids and nothing that identifies you, and it runs only if the business allows it too, as the{" "}
        <Link href="/privacy#product-data" className="underline">privacy policy</Link> describes. Nothing is sent until you allow it. On the public website, only error reports are sent.
      </p>
      <h2>Your choice</h2>
      <ul>
        <li>The banner offers &quot;Essential only&quot; and &quot;Allow anonymous measurement&quot; side by side, with equal weight.</li>
        <li>If your browser sends Global Privacy Control, we treat it as &quot;Essential only&quot; and don&apos;t ask.</li>
        <li>We ask again after 12 months. If we ever add an optional cookie, it stays off until you allow it.</li>
        <li>
          Change your mind any time: <PrivacyChoicesLink className="font-medium text-accent underline underline-offset-4" />. You can also clear cookies in your browser; you&apos;ll be signed out
          and asked again.
        </li>
      </ul>
      <h2>Third-party content</h2>
      <p>
        When a business turns on the street map, map tiles load from the map provider, which sees your IP address and the map area, as the{" "}
        <Link href="/subprocessors" className="underline">subprocessors page</Link> says. Card payments open the payment processor&apos;s own form, which follows that processor&apos;s cookie
        policy. Neither is used on the public website.
      </p>
    </LegalDoc>
  );
}
