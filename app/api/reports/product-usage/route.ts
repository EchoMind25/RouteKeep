import { apiMember, PRIVATE } from "@/lib/auth/api";
import { OFFICE_ROLES } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { renderUsageReport } from "@/lib/reports/product-usage-pdf";
import { CSV_ROWS, parseUsageFilters, PDF_ROWS, usageCsv, usageFileName } from "@/lib/reports/product-usage";
import { productUsage } from "@/lib/server/reports";

// FR-REC-06: the product usage report as CSV (every record, every CR-01 field)
// or PDF (totals and each application), for the office.
export async function GET(request: Request) {
  if (!isEnabled("reports")) return new Response(null, { status: 404, headers: PRIVATE });
  const member = await apiMember(request, OFFICE_ROLES);
  if (member instanceof Response) return member;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const format = params.format === "pdf" ? "pdf" : "csv";
  const { filters } = parseUsageFilters(params, todayIn(member.timezone));
  const report = await productUsage(member, filters, format === "pdf" ? PDF_ROWS : CSV_ROWS);
  const name = usageFileName(filters, format);
  if (format === "pdf") {
    const pdf = await renderUsageReport(report);
    return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
      headers: { ...PRIVATE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"` },
    });
  }
  return new Response(usageCsv(report), {
    headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
