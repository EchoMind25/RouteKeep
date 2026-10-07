import { toCsv, type Cell } from "@/lib/csv";
import { COMMISSION_STATUS } from "@/lib/domain/commission";
import { instantToZoned, type LocalDate } from "@/lib/domain/time";
import type { CommissionFilters, CommissionRow } from "@/lib/server/sales";
import { parseUsageFilters } from "./product-usage";

// FR-SAL-04: the commissions report's filters and CSV, shared by the screen and the download.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["pending", "approved", "paid", "void"] as const;

export function parseCommissionFilters(params: { from?: string; to?: string; technician?: string; status?: string }, today: LocalDate): { filters: CommissionFilters; problem: string | null } {
  const { filters, problem } = parseUsageFilters({ from: params.from, to: params.to }, today);
  return {
    filters: {
      from: filters.from,
      to: filters.to,
      technicianId: params.technician && UUID.test(params.technician) ? params.technician : null,
      status: (STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as CommissionFilters["status"]) : null,
    },
    problem,
  };
}

export function commissionQuery(filters: CommissionFilters, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    from: filters.from,
    to: filters.to,
    ...(filters.technicianId ? { technician: filters.technicianId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...extra,
  }).toString();
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function commissionsCsv(rows: CommissionRow[], timeZone: string): string {
  const header: Cell[] = ["Sold on", "Time zone", "Technician", "Customer", "Plan", "First service price", "Flat amount", "Percent", "Commission", "Status", "Note", "Commission id"];
  return toCsv([
    header,
    ...rows.map((r): Cell[] => [
      instantToZoned(r.createdAt, timeZone).date, timeZone, r.technicianName, r.customerName, r.planName, dollars(r.basisCents), dollars(r.flatCents), r.pct,
      dollars(r.amountCents), COMMISSION_STATUS[r.status]?.label ?? r.status, r.note, r.id,
    ]),
  ]);
}
