import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SUBPROCESSORS } from "@/lib/legal/subprocessors";
import { LEGAL_UPDATED } from "@/lib/legal/policy";

export const metadata: Metadata = { title: "Subprocessors", alternates: { canonical: "/subprocessors" }, robots: { index: true, follow: true } };

// CR-13, NFR-08: everyone who touches customer data, and exactly what they get.
export default function SubprocessorsPage() {
  return (
    <LegalDoc title="Subprocessors" updated={LEGAL_UPDATED}>
      <p>These services help run the app. Each receives only the data listed. We post changes here at least 30 days before a new one receives customer data.</p>
      <Table label="Subprocessors">
        <THead>
          <tr>
            <TH>Service</TH>
            <TH>What for</TH>
            <TH>What it receives</TH>
            <TH>When</TH>
          </tr>
        </THead>
        <TBody>
          {SUBPROCESSORS.map((s) => (
            <TR key={s.name}>
              <TD className="font-medium">{s.name}</TD>
              <TD>{s.purpose}</TD>
              <TD>
                {s.data} <span className="text-fg-muted">({s.where})</span>
              </TD>
              <TD>{s.when}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </LegalDoc>
  );
}
