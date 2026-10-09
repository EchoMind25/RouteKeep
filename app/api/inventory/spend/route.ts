import { apiMember, PRIVATE } from "@/lib/auth/api";
import { INVENTORY_ROLES } from "@/lib/auth/session";
import { todayIn } from "@/lib/domain/time";
import { isEnabled } from "@/lib/flags";
import { spendCsv } from "@/lib/inventory/spend-csv";
import { costPerVisit, spend } from "@/lib/server/inventory";

// FR-INV-09: material spend as CSV, owner, admin and office only.
export async function GET(request: Request) {
  if (!isEnabled("inventory")) return new Response(null, { status: 404, headers: PRIVATE });
  const member = await apiMember(request, INVENTORY_ROLES);
  if (member instanceof Response) return member;
  const [months, costs] = await Promise.all([spend(member, 12), costPerVisit(member)]);
  return new Response(spendCsv(months, costs), {
    headers: { ...PRIVATE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="material-spend-${todayIn(member.timezone)}.csv"` },
  });
}
