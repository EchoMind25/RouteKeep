import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import tokens from "@/replica/design/tokens.json";
import { amountLabel, areaLabel, formatNumber, isAmountUnit, isAreaUnit, isMixUnit, mixLabel } from "@/lib/domain/units";
import type { ServiceRecord } from "@/lib/server/records";
import { BRAND } from "@/lib/brand";
import { formatInstant, formatLocalDate, SIGNAL_WORD } from "@/lib/ui/format";

// FR-REC-02, CR-01, CR-03: the service record the customer receives. Business
// name and license number head every page. Built-in PDF fonts only, so making
// a record fetches nothing from anywhere (NFR-08).

const c = tokens.color.light;

// Words wrap whole: "gal-lon" in a record is harder to read than a short line.
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  // Line height lives on this wrapper, not the Page: with it on the Page, react-pdf drops the
  // footer. The font size is repeated here because the line height is resolved against it.
  body: { fontSize: 10, lineHeight: 1.35 },
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: c.fg },
  header: { borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 10, marginBottom: 14 },
  business: { fontSize: 14, lineHeight: 1.25, fontFamily: "Helvetica-Bold" },
  muted: { color: c["fg-muted"] },
  title: { fontSize: 18, lineHeight: 1.2, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  section: { marginTop: 14 },
  h2: { fontSize: 11, lineHeight: 1.25, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 120, color: c["fg-muted"] },
  value: { flex: 1 },
  product: { borderWidth: 1, borderColor: c.line, borderRadius: 4, padding: 8, marginBottom: 8 },
  productName: { fontFamily: "Helvetica-Bold", fontSize: 11, lineHeight: 1.25, marginBottom: 4 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: c["fg-muted"], flexDirection: "row", justifyContent: "space-between" },
  signature: { height: 60, width: 200, objectFit: "contain", objectPositionX: 0, marginTop: 4 },
});

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

const q = (v: number | null, u: string | null, label: (x: never) => string, ok: (x: string) => boolean) => (v === null || !u || !ok(u) ? "" : `${formatNumber(v)} ${label(u as never)}`);

function RecordDocument({ record, signature }: { record: ServiceRecord; signature: { data: Buffer; format: "png" | "jpg" } | null }) {
  const { visit, business, applications } = record;
  const tz = visit.timeZone;
  return (
    <Document title={`Service record, ${visit.customerName}`} author={business.name} creator={business.name} producer={business.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.body}>
          <View style={s.header} fixed>
            <Text style={s.business}>{business.name}</Text>
            <Text style={s.muted}>
              {business.address}
              {business.address ? "  ·  " : ""}Pesticide business license {business.licenseNo}
            </Text>
          </View>

          <Text style={s.title}>Service record</Text>
          <Row label="Customer" value={visit.customerName} />
          <Row label="Service address" value={visit.address} />
          <Row label="Service" value={visit.serviceType} />
          <Row label="Date" value={visit.localDate ? formatLocalDate(visit.localDate, "long") : ""} />
          <Row label="Arrived" value={formatInstant(visit.arrivedAt, tz)} />
          <Row label="Completed" value={formatInstant(visit.completedAt, tz)} />
          <Row label="Technician" value={visit.technicianName ?? ""} />

          <View style={s.section}>
            <Text style={s.h2}>Products applied</Text>
            {applications.length === 0 ? <Text style={s.muted}>No products were applied at this visit.</Text> : null}
            {applications.map((a) => (
              <View key={a.id} style={s.product} wrap={false}>
                <Text style={s.productName}>{a.productName}</Text>
                <Row label="EPA registration no." value={a.epaRegNo ?? (a.productKind === "minimum_risk" ? "Exempt, FIFRA 25(b)" : "")} />
                <Row label="Signal word" value={a.signalWord ? (SIGNAL_WORD[a.signalWord] ?? a.signalWord) : ""} />
                <Row label="Mix rate" value={q(a.mixRate, a.mixUnit, mixLabel, isMixUnit)} />
                <Row label="Total applied" value={q(a.totalAmount, a.amountUnit, amountLabel, isAmountUnit)} />
                <Row label="Area treated" value={q(a.areaTreated, a.areaUnit, areaLabel, isAreaUnit)} />
                <Row label="Target sites" value={a.targetSites.join(", ")} />
                <Row label="Target pests" value={a.targetPests.join(", ")} />
                <Row label="Applied" value={formatInstant(a.appliedAt, tz)} />
                <Row label="Applicator" value={`${a.applicatorName ?? ""}${a.applicatorLicenseNo ? `, license ${a.applicatorLicenseNo}` : ""}`} />
                {a.restrictedUse ? <Row label="Restricted use" value={a.customerStatementAt ? `Written statement given ${formatInstant(a.customerStatementAt, tz)}` : "Yes"} /> : null}
                {a.history.length ? <Row label="Amended" value={formatInstant(a.recordedAt, tz)} /> : null}
              </View>
            ))}
          </View>

          {visit.techNotes ? (
            <View style={s.section}>
              <Text style={s.h2}>Technician notes</Text>
              <Text>{visit.techNotes}</Text>
            </View>
          ) : null}

          {signature || visit.signerName ? (
            <View style={s.section} wrap={false}>
              <Text style={s.h2}>Customer signature</Text>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image is not an HTML img; the signer's name follows */}
              {signature ? <Image style={s.signature} src={signature} /> : null}
              {visit.signerName ? <Text>{visit.signerName}</Text> : null}
            </View>
          ) : null}

        </View>

        <View style={s.footer} fixed>
          <Text>
            {business.name}, license {business.licenseNo}
            {/* FR-BRD-03: the product credit, unless the business bought white label (D-14). */}
            {business.whiteLabel ? "" : `. Powered by ${BRAND.name}`}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderServiceRecord(record: ServiceRecord, signature: { body: Uint8Array; contentType: string } | null): Promise<Buffer> {
  const image = signature && (signature.contentType === "image/png" || signature.contentType === "image/jpeg") ? { data: Buffer.from(signature.body), format: signature.contentType === "image/png" ? ("png" as const) : ("jpg" as const) } : null;
  return renderToBuffer(<RecordDocument record={record} signature={image} />);
}
