import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import tokens from "@/replica/design/tokens.json";
import { formatCents } from "@/lib/domain/money";
import type { InvoiceDetail } from "@/lib/server/billing";
import { formatInstant, formatLocalDate } from "@/lib/ui/format";

// FR-BRD-01, CR-03: the invoice a customer receives. The business's logo,
// name, address and license, and nothing of ours: no product name on the page
// or in the file's metadata, on every plan. Built-in fonts, nothing fetched.

const c = tokens.color.light;

Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  // Line height lives on this wrapper, not the Page: with it on the Page,
  // react-pdf drops the footer. The font size is repeated for the same reason.
  body: { fontSize: 10, lineHeight: 1.35 },
  page: { padding: 44, fontSize: 10, fontFamily: "Helvetica", color: c.fg },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 26 },
  logo: { maxWidth: 160, maxHeight: 60, objectFit: "contain", marginBottom: 8 },
  business: { fontSize: 13, lineHeight: 1.25, fontFamily: "Helvetica-Bold" },
  muted: { color: c["fg-muted"] },
  title: { fontSize: 22, lineHeight: 1.2, fontFamily: "Helvetica-Bold", textAlign: "right" },
  right: { textAlign: "right" },
  billTo: { marginBottom: 22 },
  label: { fontSize: 8, color: c["fg-muted"], marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.6 },
  thead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 5, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: c.line, paddingVertical: 6 },
  desc: { flex: 1, paddingRight: 10 },
  num: { width: 90, textAlign: "right" },
  totals: { marginTop: 14, marginLeft: "auto", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  due: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.fg, fontSize: 13, lineHeight: 1.25, fontFamily: "Helvetica-Bold" },
  stamp: { marginTop: 18, fontSize: 12, lineHeight: 1.25, fontFamily: "Helvetica-Bold", color: c.success },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 8, color: c["fg-muted"], flexDirection: "row", justifyContent: "space-between" },
});

const PAYMENT: Record<string, string> = { cash: "Cash", check: "Check", other: "Payment", card: "Card", ach: "Bank transfer", card_on_file: "Card on file" };

function InvoiceDocument({ invoice, logo }: { invoice: InvoiceDetail; logo: { data: Buffer; format: "png" | "jpg" } | null }) {
  const { business, customer } = invoice;
  const tz = invoice.timeZone;
  const received = invoice.ledger.filter((e) => e.type !== "invoice");
  return (
    <Document title={`Invoice ${invoice.number}, ${business.name}`} author={business.name} creator={business.name} producer={business.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.body}>
          <View style={s.top}>
            <View>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image is not an HTML img; the business name follows */}
              {logo ? <Image style={s.logo} src={logo} /> : null}
              <Text style={s.business}>{business.name}</Text>
              <Text style={s.muted}>{business.address}</Text>
              <Text style={s.muted}>Pesticide business license {business.licenseNo}</Text>
            </View>
            <View>
              <Text style={s.title}>Invoice</Text>
              <Text style={s.right}>No. {invoice.number}</Text>
              <Text style={[s.right, s.muted]}>Issued {invoice.issuedAt ? formatInstant(invoice.issuedAt, tz) : ""}</Text>
              <Text style={[s.right, s.muted]}>Due {invoice.dueDate ? formatLocalDate(invoice.dueDate, "full") : "on receipt"}</Text>
            </View>
          </View>

          <View style={s.billTo}>
            <Text style={s.label}>Bill to</Text>
            <Text>{customer.name}</Text>
            {customer.address ? <Text style={s.muted}>{customer.address}</Text> : null}
          </View>

          <View style={s.thead}>
            <Text style={s.desc}>Service</Text>
            <Text style={s.num}>Amount</Text>
          </View>
          {invoice.lines.map((l) => (
            <View key={l.id} style={s.row} wrap={false}>
              <Text style={s.desc}>
                {l.description}
                {l.quantity !== 1 ? ` (x${l.quantity})` : ""}
              </Text>
              <Text style={s.num}>{formatCents(l.amountCents)}</Text>
            </View>
          ))}

          <View style={s.totals}>
            <View style={s.totalRow}>
              <Text>Total</Text>
              <Text>{formatCents(invoice.totalCents)}</Text>
            </View>
            {received.map((e) => (
              <View key={e.id} style={s.totalRow}>
                <Text style={s.muted}>
                  {e.type === "payment" ? `${PAYMENT[e.method ?? ""] ?? "Payment"}${e.checkNumber ? ` #${e.checkNumber}` : ""}` : e.type === "credit" ? "Credit" : "Adjustment"}, {formatInstant(e.occurredAt, tz)}
                </Text>
                <Text style={s.muted}>{formatCents(e.amountCents)}</Text>
              </View>
            ))}
            <View style={s.due}>
              <Text>{invoice.status === "void" ? "Void" : "Balance due"}</Text>
              <Text>{formatCents(invoice.status === "void" ? 0 : invoice.openCents)}</Text>
            </View>
            {invoice.status === "paid" ? <Text style={s.stamp}>Paid in full. Thank you.</Text> : null}
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>
            {business.name}, license {business.licenseNo}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoice(invoice: InvoiceDetail, logo: { body: Uint8Array; contentType: string } | null): Promise<Buffer> {
  const image = logo && (logo.contentType === "image/png" || logo.contentType === "image/jpeg") ? { data: Buffer.from(logo.body), format: logo.contentType === "image/png" ? ("png" as const) : ("jpg" as const) } : null;
  return renderToBuffer(<InvoiceDocument invoice={invoice} logo={image} />);
}
