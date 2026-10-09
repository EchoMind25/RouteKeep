import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { BRAND } from "@/lib/brand";
import { LEGAL_UPDATED } from "@/lib/legal/policy";

export const metadata: Metadata = { title: "Field Staff Notice", alternates: { canonical: "/employee-notice" }, robots: { index: true, follow: true } };

// CR-18: what the app records about the people who use it at work, written to
// be handed to them. Businesses give this to staff; some states require
// written notice of electronic monitoring before it starts.
export default function EmployeeNoticePage() {
  return (
    <LegalDoc title="Field Staff Notice" updated={LEGAL_UPDATED}>
      <p>
        Your employer uses {BRAND.name} to schedule work, keep pesticide records and plan supplies. This notice tells you, in plain words, what the app records about you while you work, why,
        and who can see it. Your employer is responsible for these records; {BRAND.name} stores them for your employer.
      </p>

      <h2>What the app records about your work</h2>
      <ul>
        <li>Your name, work email, role, and your applicator license number and expiry date.</li>
        <li>The visits assigned to you, and the times you mark a visit as arrived and completed.</li>
        <li>Application records you fill in: products, amounts, mix rates, target pests and notes, which state rules require.</li>
        <li>Photos and customer signatures you capture at a visit.</li>
        <li>The truck or vehicle you are assigned, and the stock counts you submit on resupply day.</li>
        <li>How much product you use per visit compared with other technicians doing the same service, which can show over- or under-application.</li>
        <li>Changes you make to records, with the time, kept in a change history so records can be trusted.</li>
        <li>When you sign in, and a technical record of the requests your phone makes, kept for security.</li>
      </ul>

      <h2>What it does not record</h2>
      <ul>
        <li>
          <strong>Your location.</strong> The app does not read your phone&apos;s GPS or track where you or your truck are. If your employer ever turns on a location feature, you will get an
          updated notice first and your phone will ask for your permission.
        </li>
        <li>Anything on your phone outside the app: your other apps, messages, photos, contacts, calls or browsing.</li>
        <li>Anything while you are not signed in to the app.</li>
      </ul>

      <h2>Why</h2>
      <ul>
        <li>To plan and run the day&apos;s work and tell customers when to expect you.</li>
        <li>To keep the pesticide records the law requires, signed by the licensed applicator.</li>
        <li>To know what is on each truck and order supplies before they run out.</li>
        <li>To spot training needs and label compliance problems, such as an unusual amount of product per visit.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Owners, admins and office staff at your employer can see work records and stock counts. Other technicians see only what they need to do their own work. {BRAND.name} staff see it only to
        support your employer or keep the service secure. The services that help run the app are listed on the <Link href="/subprocessors" className="underline">subprocessors page</Link>.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Work records are kept while your employer uses {BRAND.name}. Pesticide application records are kept at least 2 years as state rules require, even after you leave. More detail is in
        the <Link href="/privacy#retention" className="underline">privacy policy</Link>.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask your employer to see or correct what the app holds about you. Depending on your state you may have more rights, such as a copy of your records or deletion of what the law does
        not require to be kept. If your employer can&apos;t help, email the address in the <Link href="/privacy#contact" className="underline">privacy policy</Link> and we will work with them to
        answer you.
      </p>

      <h2>For employers</h2>
      <ul>
        <li>Give this notice to every person who uses the technician or office app, before they start and whenever it changes. Keep a record that you did.</li>
        <li>
          Some states require written notice of electronic monitoring and, in some, a signed acknowledgment or a posted notice (for example New York, Connecticut and Delaware). This notice is
          written to help, but you are responsible for your state&apos;s rules; ask your attorney if unsure.
        </li>
        <li>Use these records for the purposes above, and treat them as confidential personnel records.</li>
      </ul>
    </LegalDoc>
  );
}
