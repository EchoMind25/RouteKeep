import "server-only";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import tokens from "@/replica/design/tokens.json";
import { instantToZoned } from "@/lib/domain/time";
import { formatInstant, formatLocalDate, formatTime } from "@/lib/ui/format";
import { amountText, areaText, mixText, PDF_ROWS, totalText, type UsageReport } from "./product-usage";

// FR-REC-06, CR-03: the product usage report as a PDF. Business name and
// license on every page; built-in PDF fonts only, so nothing is fetched (NFR-08).

const c = tokens.color.light;

// Words wrap whole: "gal-lon" in a record is harder to read than a short line.
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  // Line height lives on this wrapper, not the Page: with it on the Page, react-pdf drops the
  // footer. The font size is repeated here because the line height is resolved against it.
  body: { fontSize: 8.5, lineHeight: 1.3 },
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 36, fontSize: 8.5, fontFamily: "Helvetica", color: c.fg },
  header: { borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 8, marginBottom: 12 },
  business: { fontSize: 12, lineHeight: 1.25, fontFamily: "Helvetica-Bold" },
  muted: { color: c["fg-muted"] },
  title: { fontSize: 16, lineHeight: 1.2, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  meta: { marginBottom: 10, color: c["fg-muted"] },
  h2: { fontSize: 10, lineHeight: 1.25, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  note: { marginBottom: 6, color: c["fg-muted"] },
  thead: { flexDirection: "row", backgroundColor: c.sunken, borderBottomWidth: 1, borderBottomColor: c.line, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: c.line },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7.5, color: c["fg-muted"], flexDirection: "row", justifyContent: "space-between" },
});

type Column<T> = { label: string; width: number | string; value: (row: T) => string };

function Table<T>({ columns, rows, keyOf }: { columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string }) {
  return (
    <View>
      <View style={s.thead} fixed>
        {columns.map((col) => (
          <Text key={col.label} style={[s.cell, { width: col.width }]}>
            {col.label}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={keyOf(row)} style={s.row} wrap={false}>
          {columns.map((col) => (
            <Text key={col.label} style={[s.cell, { width: col.width }]}>
              {col.value(row)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function UsageDocument({ report, generatedAt }: { report: UsageReport; generatedAt: Date }) {
  const { business, filters, timeZone: tz } = report;
  const range = `${formatLocalDate(filters.from, "full")} to ${formatLocalDate(filters.to, "full")}`;
  const scope = [report.productLabel ?? "All products", report.technicianLabel ?? "all technicians"].join(", ");
  return (
    <Document title={`Product usage, ${range}`} author={business.name} creator={business.name} producer={business.name}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <View style={s.body}>
          <View style={s.header} fixed>
            <Text style={s.business}>{business.name}</Text>
            <Text style={s.muted}>
              {business.address}
              {business.address ? "  ·  " : ""}Pesticide business license {business.licenseNo}
            </Text>
          </View>

          <Text style={s.title}>Product usage</Text>
          <Text style={s.meta}>
            {range}. {scope}. {report.count.toLocaleString("en-US")} {report.count === 1 ? "application" : "applications"}. Amended records are shown as amended.
          </Text>

          <Text style={s.h2}>Totals by product</Text>
          {report.totals.length === 0 ? <Text style={s.note}>No products were applied in this range.</Text> : null}
          {report.totals.length ? (
            <Table
              rows={report.totals}
              keyOf={(t) => `${t.productName}|${t.epaRegNo ?? ""}`}
              columns={[
                { label: "Product", width: "40%", value: (t) => `${t.productName}${t.restrictedUse ? " (restricted use)" : ""}` },
                { label: "EPA registration no.", width: "20%", value: (t) => t.epaRegNo ?? "" },
                { label: "Applications", width: "12%", value: (t) => t.applications.toLocaleString("en-US") },
                { label: "Total applied", width: "28%", value: (t) => totalText(t) },
              ]}
            />
          ) : null}

          {report.rows.length ? (
            <View break={report.totals.length > 12}>
              <Text style={s.h2}>Each application</Text>
              {report.truncated ? (
                <Text style={s.note}>
                  This PDF lists the first {PDF_ROWS.toLocaleString("en-US")} of {report.count.toLocaleString("en-US")}. The CSV download has every one.
                </Text>
              ) : null}
              <Table
                rows={report.rows}
                keyOf={(r) => r.id}
                columns={[
                  {
                    label: "Applied",
                    width: "10%",
                    value: (r) => {
                      const at = instantToZoned(r.appliedAt, tz);
                      return `${formatLocalDate(at.date, "full")}\n${formatTime(at.time)}`;
                    },
                  },
                  { label: "Applicator", width: "12%", value: (r) => `${r.applicatorName ?? ""}${r.applicatorLicenseNo ? `\n${r.applicatorLicenseNo}` : ""}` },
                  { label: "Customer and address", width: "20%", value: (r) => `${r.customerName ?? ""}\n${r.applicationAddress ?? ""}` },
                  { label: "Product", width: "16%", value: (r) => `${r.productName}${r.epaRegNo ? `\nEPA ${r.epaRegNo}` : ""}${r.amendment ? "\nAmended" : ""}` },
                  { label: "Mix rate", width: "13%", value: (r) => mixText(r.mixRate, r.mixUnit) },
                  { label: "Total", width: "8%", value: (r) => amountText(r.totalAmount, r.amountUnit) },
                  { label: "Area", width: "8%", value: (r) => areaText(r.areaTreated, r.areaUnit) },
                  { label: "Sites and pests", width: "13%", value: (r) => `${r.targetSites.join(", ")}\n${r.targetPests.join(", ")}` },
                ]}
              />
            </View>
          ) : null}

        </View>

        <View style={s.footer} fixed>
          <Text>
            {business.name}, license {business.licenseNo}. Made {formatInstant(generatedAt, tz)}.
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderUsageReport(report: UsageReport, generatedAt: Date = new Date()): Promise<Buffer> {
  return renderToBuffer(<UsageDocument report={report} generatedAt={generatedAt} />);
}
