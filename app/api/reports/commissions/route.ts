import { apiMember, PRIVATE } from "@/lib/auth/api";
import { OFFICE_ROLES } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { commissionsCsv, parseCommissionFilters } from "@/lib/reports/commissions";
import { listCommissions } from "@/lib/server/sales";

// FR-SAL-04: commissions as CSV for payroll, office roles only.
export async function GET(request: Request) {
  if (!isEnabled("reports")) return new Response(null, { status: 404, headers: PRIVATE });
  const member = await apiMember(request, OFFICE_ROLES);
  if (member instanceof Response) return member;
  const { filters } = parseCommissionFilters(Object.fromEntries(new URL(request.url).searchParams), todayIn(member.timezone));
  const { rows, timeZone } = await listCommissions(member, filters, 100_000);
  return new Response(commissionsCsv(rows, timeZone), {
    headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="commissions-${filters.from}-to-${filters.to}.csv"` },
  });
}
